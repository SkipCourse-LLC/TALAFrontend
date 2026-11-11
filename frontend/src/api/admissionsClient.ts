import { TalaApiError } from "./errors";
import { readBoundedResponse } from "./http";
import type { ApiRequest, HttpTransport } from "./http";
import type { User } from "./types";
import type {
  AdmissionInterestInput,
  AdmissionReviewInput,
  DocumentPreference,
  AdmissionStudentInput,
} from "./admissionsContract";
import * as decode from "./admissionsDecoders";

interface Dependencies {
  transport: HttpTransport;
  authenticated: <T>(
    signal: AbortSignal | undefined,
    action: (user: User, bound: HttpTransport) => Promise<T>,
  ) => Promise<T>;
  authAction: (
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ) => Promise<User | null>;
  clearCsrf: () => void;
}
const safeId = (id: string) => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
    throw new TalaApiError("INVALID_INPUT");
  return encodeURIComponent(id);
};
export function createAdmissionsClient({
  transport,
  authenticated,
  authAction,
  clearCsrf,
}: Dependencies) {
  async function json<T>(
    path: string,
    input: ApiRequest,
    parser: (raw: unknown) => T,
  ): Promise<T> {
    try {
      return await transport.json(path, input, parser);
    } catch (failure) {
      if (failure instanceof TalaApiError && failure.code === "CSRF_INVALID")
        clearCsrf();
      throw failure;
    }
  }
  function post<T>(
    path: string,
    input: unknown,
    signal: AbortSignal | undefined,
    parser: (raw: unknown) => T,
    applicationId?: string,
  ) {
    return json(
      path,
      {
        method: "POST",
        body: JSON.stringify(input),
        contentType: "application/json",
        signal,
        ...(applicationId ? { expectedApplication: applicationId } : {}),
      },
      parser,
    );
  }
  function operator<T>(
    signal: AbortSignal | undefined,
    action: (bound: HttpTransport) => Promise<T>,
  ) {
    return authenticated(signal, (user, bound) => {
      if (user.role !== "operator") throw new TalaApiError("FORBIDDEN");
      return action(bound);
    });
  }
  const body = (input: unknown, signal?: AbortSignal): ApiRequest => ({
    method: "POST",
    body: JSON.stringify(input),
    contentType: "application/json",
    signal,
  });
  async function download(
    bound: HttpTransport,
    id: string,
    signal?: AbortSignal,
    applicationId?: string,
  ) {
    return bound.request(
      `/api/admissions/documents/${safeId(id)}/content`,
      {
        signal,
        accept: "application/octet-stream",
        ...(applicationId ? { expectedApplication: applicationId } : {}),
      },
      async (response, readSignal) => {
        const mime = (response.headers.get("content-type") ?? "")
          .split(";")[0]!
          .trim();
        if (mime !== "text/plain" && mime !== "application/pdf")
          throw new TalaApiError("INVALID_RESPONSE");
        const bytes = await readBoundedResponse(
          response,
          5 * 1024 * 1024,
          readSignal,
        );
        if (!bytes.byteLength) throw new TalaApiError("INVALID_RESPONSE");
        // Never use a server-supplied filename as a path or HTML.
        return {
          blob: new Blob([bytes], { type: mime }),
          filename: `application-document.${mime === "application/pdf" ? "pdf" : "txt"}`,
        };
      },
    );
  }
  return {
    current(signal?: AbortSignal, expectedApplication?: string) {
      return json(
        "/api/admissions/current",
        { signal, expectedApplication },
        decode.current,
      );
    },
    submitInterest(input: AdmissionInterestInput, signal?: AbortSignal) {
      return post(
        "/api/admissions/applications",
        input,
        signal,
        decode.current,
      );
    },
    bookInterview(
      applicationId: string,
      input: { slotId: string; version: number; requestId: string },
      signal?: AbortSignal,
    ) {
      return post(
        "/api/admissions/interview",
        input,
        signal,
        decode.current,
        applicationId,
      );
    },
    setDocumentPreference(
      applicationId: string,
      input: {
        preference: DocumentPreference;
        version: number;
        requestId: string;
      },
      signal?: AbortSignal,
    ) {
      return post(
        "/api/admissions/document-preference",
        input,
        signal,
        decode.current,
        applicationId,
      );
    },
    createDocumentIntent(
      applicationId: string,
      input: {
        name: string;
        contentType: string;
        size: number;
        sha256: string;
        requestId: string;
      },
      signal?: AbortSignal,
    ) {
      return post(
        "/api/admissions/documents/intents",
        input,
        signal,
        decode.uploadIntent,
        applicationId,
      );
    },
    uploadDocument(
      applicationId: string,
      uploadId: string,
      file: File,
      signal?: AbortSignal,
    ) {
      return json(
        `/api/admissions/documents/${safeId(uploadId)}/content`,
        {
          method: "PUT",
          body: file,
          contentType: file.type,
          signal,
          expectedApplication: applicationId,
        },
        decode.current,
      );
    },
    downloadDocument(id: string, signal?: AbortSignal, applicationId?: string) {
      return applicationId
        ? download(transport, id, signal, applicationId)
        : authenticated(signal, (_user, bound) => download(bound, id, signal));
    },
    endAccess(applicationId: string, signal?: AbortSignal) {
      return post(
        "/api/admissions/access/end",
        {},
        signal,
        (raw) => {
          if (!raw || typeof raw !== "object")
            throw new TalaApiError("INVALID_RESPONSE");
          return undefined;
        },
        applicationId,
      );
    },
    inspectInvitation(token: string, signal?: AbortSignal) {
      return post(
        "/api/admissions/invitation/inspect",
        { token },
        signal,
        decode.inspection,
      );
    },
    async enroll(
      input: { token: string; name: string; password: string },
      signal?: AbortSignal,
    ) {
      const user = await authAction("/api/auth/enroll", input, signal);
      if (!user || user.role !== "parent")
        throw new TalaApiError("INVALID_RESPONSE");
      return user;
    },
    listApplications(signal?: AbortSignal) {
      return operator(signal, (bound) =>
        bound.json("/api/operator/admissions", { signal }, decode.applications),
      );
    },
    applicationDetail(id: string, signal?: AbortSignal) {
      return operator(signal, (bound) =>
        bound.json(
          `/api/operator/admissions/${safeId(id)}`,
          { signal },
          decode.detail,
        ),
      );
    },
    reviewApplication(
      id: string,
      input: AdmissionReviewInput,
      signal?: AbortSignal,
    ) {
      return operator(signal, (bound) =>
        bound.json(
          `/api/operator/admissions/${safeId(id)}/review`,
          body(input, signal),
          decode.detail,
        ),
      );
    },
    issueInvitation(
      id: string,
      input: { version: number; requestId: string },
      signal?: AbortSignal,
    ) {
      return operator(signal, (bound) =>
        bound.json(
          `/api/operator/admissions/${safeId(id)}/invitation`,
          body(input, signal),
          decode.invitation,
        ),
      );
    },
    authorizeStudentSetup(
      id: string,
      input: { version: number; requestId: string },
      signal?: AbortSignal,
    ) {
      return operator(signal, (bound) =>
        bound.json(
          `/api/operator/admissions/${safeId(id)}/student-setup`,
          body(input, signal),
          decode.detail,
        ),
      );
    },
    provisionStudent(
      id: string,
      input: AdmissionStudentInput,
      signal?: AbortSignal,
    ) {
      return authenticated(signal, async (user, bound) => {
        if (user.role !== "parent") throw new TalaApiError("FORBIDDEN");
        const saved = await bound.json(
          `/api/admissions/${safeId(id)}/student-account`,
          body(input, signal),
          decode.studentResult,
        );
        if (
          saved.application.id !== id ||
          saved.application.enrolledParentUid !== user.uid
        )
          throw new TalaApiError("INVALID_RESPONSE");
        return saved;
      });
    },
    addInterviewTime(
      input: {
        startsAt: string;
        endsAt: string;
        label?: string;
        requestId: string;
      },
      signal?: AbortSignal,
    ) {
      return operator(signal, (bound) =>
        bound.json(
          "/api/operator/admissions/availability",
          body(input, signal),
          decode.slot,
        ),
      );
    },
    parentApplications(signal?: AbortSignal) {
      return authenticated(signal, (user, bound) => {
        if (user.role !== "parent") throw new TalaApiError("FORBIDDEN");
        return bound.json("/api/admissions/parent", { signal }, (raw) => {
          const result = decode.applications(raw);
          if (result.applications.some((a) => a.enrolledParentUid !== user.uid))
            throw new TalaApiError("INVALID_RESPONSE");
          return result;
        });
      });
    },
  };
}
