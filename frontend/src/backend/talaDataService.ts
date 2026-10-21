import { getIdTokenResult } from "firebase/auth";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytesResumable } from "firebase/storage";
import { getFirebaseClient } from "./firebaseClient";
import type { FirebaseClient } from "./firebaseClient";
import { FirebaseConfigurationError } from "./firebaseConfiguration";
import {
  EvidenceContractError,
  MAX_EVIDENCE_BYTES,
  validateEvidenceUploadStatus,
} from "./evidenceContract";
import type { EvidenceContentType } from "./evidenceContract";
export {
  MAX_EVIDENCE_BYTES,
  validateEvidenceUploadStatus,
} from "./evidenceContract";
export type {
  EvidenceContentType,
  TalaEvidenceUploadStatus,
} from "./evidenceContract";

/** Isolated Emulator/test-cloud contract; never a SkipClass production schema. */

export interface TalaSlot {
  id: string;
  startsAt: string;
  endsAt: string;
}
export interface TalaAppointment extends TalaSlot {
  ownerUid: string;
  slotId: string;
  status: "reserved" | "cancelled" | "ended";
  meetingIntegration: "unavailable";
  updatedAt: string;
}
export interface TalaEvidence {
  id: string;
  ownerUid: string;
  appointmentId: string;
  title: string;
  contentType: EvidenceContentType;
  size: number;
  status: "submitted";
  reviewStatus: "not_reviewed";
  submittedAt: string;
}
export interface TalaProgress {
  submittedEvidenceCount: number;
  assessedEvidenceCount: number;
  acknowledgedOutcomeCount: number;
  masteryStatus: "unavailable";
}
export interface TalaWorkspaceSnapshot {
  slots: TalaSlot[];
  appointments: TalaAppointment[];
  activeAppointments: TalaAppointment[];
  evidence: TalaEvidence[];
  progress: TalaProgress;
  loading: boolean;
  fromCache: boolean;
}
export interface TalaUploadIntent {
  uploadId: string;
  storagePath: string;
  expiresAt: string;
  maxBytes: number;
  sha256: string;
}
export interface TalaLearningOutcome {
  id: string;
  summary: string;
  status: "published";
  source: "staff" | "authorized_ai";
  publishedAt: string;
}
export interface TalaLearningRecord {
  id: string;
  appointmentId: string;
  status: "published";
  attendance: "confirmed" | "not_recorded";
  outcomes: TalaLearningOutcome[];
  acknowledgedOutcomeIds: string[];
  updatedAt: string;
}
export interface TalaLearningRecords {
  records: TalaLearningRecord[];
  integrations: { zoom: "unavailable"; ai: "unavailable" };
}
export interface TalaFamilyLinks {
  relationships: Array<{
    id: string;
    studentUid: string;
    parentUid: string;
    status: "active";
    consent: "recorded";
  }>;
  linkedProfiles: Array<{
    uid: string;
    role: "student" | "parent";
    displayName: string;
  }>;
}
type DataErrorCode =
  | "INTEGRATION_UNAVAILABLE"
  | "AUTH_REQUIRED"
  | "EMAIL_UNVERIFIED"
  | "PERMISSION_DENIED"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "NOT_FOUND"
  | "EXPIRED"
  | "NETWORK"
  | "CANCELLED"
  | "INVALID_RESPONSE"
  | "UNAVAILABLE";
const messages: Record<DataErrorCode, string> = {
  INTEGRATION_UNAVAILABLE:
    "This workflow is available only in an approved isolated Firebase environment. The team's production contract is not connected.",
  AUTH_REQUIRED: "Your session changed. Sign in again before continuing.",
  EMAIL_UNVERIFIED: "Verify your account email before using this workspace.",
  PERMISSION_DENIED:
    "You do not have permission to complete this action. Refresh your session or ask the team to review your account.",
  INVALID_INPUT:
    "Check the selected booking, title and file. Use a synthetic text or PDF file no larger than 5 MiB.",
  CONFLICT:
    "This booking or request has changed. Refresh the workspace before trying again.",
  NOT_FOUND: "This record is no longer available. Refresh and choose another.",
  EXPIRED: "This upload expired. Choose the file again to start a new upload.",
  NETWORK:
    "The Firebase backend could not be reached. Check your connection and the selected environment, then retry.",
  CANCELLED: "The upload was cancelled. No submission was confirmed.",
  INVALID_RESPONSE:
    "The backend returned an unexpected record. No successful action can be confirmed. Refresh or ask the team to check the service.",
  UNAVAILABLE:
    "The action could not be confirmed. Retry the same request when the backend is available.",
};
export class TalaDataError extends Error {
  constructor(readonly code: DataErrorCode) {
    super(messages[code]);
    this.name = "TalaDataError";
  }
}
export function safeTalaDataError(error: unknown): TalaDataError {
  if (error instanceof TalaDataError) return error;
  if (error instanceof EvidenceContractError)
    return new TalaDataError(error.code);
  if (error instanceof FirebaseConfigurationError)
    return new TalaDataError("INTEGRATION_UNAVAILABLE");
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code).replace(/^(functions|storage|auth)\//, "")
      : "";
  if (
    ["unauthenticated", "user-token-expired", "user-not-found"].includes(code)
  )
    return new TalaDataError("AUTH_REQUIRED");
  if (["permission-denied", "unauthorized", "unauthorized-app"].includes(code))
    return new TalaDataError("PERMISSION_DENIED");
  if (code === "invalid-argument") return new TalaDataError("INVALID_INPUT");
  if (["already-exists", "aborted", "failed-precondition"].includes(code))
    return new TalaDataError("CONFLICT");
  if (["not-found", "object-not-found"].includes(code))
    return new TalaDataError("NOT_FOUND");
  if (code === "deadline-exceeded") return new TalaDataError("EXPIRED");
  if (
    ["unavailable", "network-request-failed", "retry-limit-exceeded"].includes(
      code,
    )
  )
    return new TalaDataError("NETWORK");
  if (code === "canceled") return new TalaDataError("CANCELLED");
  return new TalaDataError("UNAVAILABLE");
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TalaDataError("INVALID_RESPONSE");
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 200): string {
  if (typeof value !== "string" || !value || value.length > max)
    throw new TalaDataError("INVALID_RESPONSE");
  return value;
}
function instant(value: unknown): string {
  const result =
    value instanceof Timestamp ? value.toDate().toISOString() : value;
  if (typeof result !== "string" || !Number.isFinite(Date.parse(result)))
    throw new TalaDataError("INVALID_RESPONSE");
  return new Date(result).toISOString();
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new TalaDataError("INVALID_RESPONSE");
  return value;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new TalaDataError("INVALID_RESPONSE");
  return value;
}
function owned(value: Record<string, unknown>, uid: string): void {
  if (value.ownerUid !== uid) throw new TalaDataError("INVALID_RESPONSE");
}
function appointment(id: string, raw: unknown, uid: string): TalaAppointment {
  const value = object(raw);
  owned(value, uid);
  if (
    !["reserved", "cancelled", "ended"].includes(String(value.status)) ||
    value.meetingIntegration !== "unavailable"
  )
    throw new TalaDataError("INVALID_RESPONSE");
  return {
    id,
    ownerUid: uid,
    slotId: string(value.slotId),
    startsAt: instant(value.startsAt ?? value.startAt),
    endsAt: instant(value.endsAt ?? value.endAt),
    status: value.status as TalaAppointment["status"],
    meetingIntegration: "unavailable",
    updatedAt: instant(value.updatedAt),
  };
}
function evidence(id: string, raw: unknown, uid: string): TalaEvidence {
  const value = object(raw);
  owned(value, uid);
  if (
    value.status !== "submitted" ||
    value.reviewStatus !== "not_reviewed" ||
    (value.contentType !== "text/plain" &&
      value.contentType !== "application/pdf")
  )
    throw new TalaDataError("INVALID_RESPONSE");
  return {
    id,
    ownerUid: uid,
    appointmentId: string(value.appointmentId),
    title: string(value.title, 120),
    contentType: value.contentType,
    size: count(value.size),
    status: "submitted",
    reviewStatus: "not_reviewed",
    submittedAt: instant(value.submittedAt),
  };
}
function progress(raw: unknown, uid: string): TalaProgress {
  const value = object(raw);
  owned(value, uid);
  if (value.masteryStatus !== "unavailable")
    throw new TalaDataError("INVALID_RESPONSE");
  return {
    submittedEvidenceCount: count(value.submittedEvidenceCount),
    assessedEvidenceCount: count(value.assessedEvidenceCount),
    acknowledgedOutcomeCount: count(value.acknowledgedOutcomeCount ?? 0),
    masteryStatus: "unavailable",
  };
}
function requireOwner(client: FirebaseClient, uid: string): void {
  if (!uid || client.auth.currentUser?.uid !== uid)
    throw new TalaDataError("AUTH_REQUIRED");
}
async function isolatedClient(
  uid: string,
  requireStudent = true,
): Promise<FirebaseClient> {
  const client = getFirebaseClient();
  // Check the environment before reading a document or invoking any callable.
  if (!client.namespace) throw new TalaDataError("INTEGRATION_UNAVAILABLE");
  await client.ready;
  await client.auth.authStateReady();
  requireOwner(client, uid);
  const user = client.auth.currentUser!;
  let token = await getIdTokenResult(user);
  if (token.claims.aud !== client.app.options.projectId)
    throw new TalaDataError("INTEGRATION_UNAVAILABLE");
  requireOwner(client, uid);
  if (requireStudent) {
    if (!user.emailVerified) throw new TalaDataError("EMAIL_UNVERIFIED");
    // reload() can update the User before its cached ID token is refreshed.
    // Ask Firebase for fresh signed claims before treating that transition as
    // a permission failure; never infer permissions from the User or UI state.
    if (token.claims.role !== "student" || token.claims.email_verified !== true)
      token = await getIdTokenResult(user, true);
    requireOwner(client, uid);
    if (
      token.claims.aud !== client.app.options.projectId ||
      token.claims.role !== "student" ||
      token.claims.email_verified !== true
    )
      throw new TalaDataError("PERMISSION_DENIED");
  }
  return client;
}
async function call<T>(
  uid: string,
  name: string,
  input: unknown,
  student = true,
): Promise<T> {
  try {
    const client = await isolatedClient(uid, student);
    const response = await httpsCallable<unknown, T>(client.functions, name, {
      timeout: 30_000,
    })(input);
    requireOwner(client, uid);
    return response.data;
  } catch (error) {
    throw safeTalaDataError(error);
  }
}
export function newTalaRequestId(): string {
  return crypto.randomUUID();
}
export async function provisionTalaStudent(
  uid: string,
  displayName: string,
): Promise<void> {
  const name = displayName.trim();
  if (!name || name.length > 80) throw new TalaDataError("INVALID_INPUT");
  const value = object(
    await call(uid, "provisionTalaStudent", { displayName: name }, false),
  );
  if (value.uid !== uid || value.role !== "student")
    throw new TalaDataError("INVALID_RESPONSE");
  // Claims are issued by the callable, never chosen or persisted by this UI.
  const client = getFirebaseClient();
  requireOwner(client, uid);
  await client.auth.currentUser!.getIdToken(true);
  requireOwner(client, uid);
}
export async function provisionStudent(displayName: string): Promise<void> {
  const client = getFirebaseClient();
  if (!client.namespace) throw new TalaDataError("INTEGRATION_UNAVAILABLE");
  await client.ready;
  await client.auth.authStateReady();
  const uid = client.auth.currentUser?.uid;
  if (!uid) throw new TalaDataError("AUTH_REQUIRED");
  await provisionTalaStudent(uid, displayName);
}
export async function reserveAppointment(
  uid: string,
  input: { slotId: string; requestId: string; replacesAppointmentId?: string },
): Promise<TalaAppointment> {
  const value = object(await call(uid, "reserveTalaAppointment", input));
  const saved = appointment(string(value.id), value, uid);
  if (saved.status !== "reserved" || saved.slotId !== input.slotId)
    throw new TalaDataError("CONFLICT");
  return saved;
}
export async function cancelAppointment(
  uid: string,
  input: { appointmentId: string; requestId: string },
): Promise<TalaAppointment> {
  const value = object(await call(uid, "cancelTalaAppointment", input));
  const saved = appointment(string(value.id), value, uid);
  if (saved.status !== "cancelled" || saved.id !== input.appointmentId)
    throw new TalaDataError("CONFLICT");
  return saved;
}
export function validateEvidenceFile(file: File): EvidenceContentType {
  if (
    file.size < 1 ||
    file.size > MAX_EVIDENCE_BYTES ||
    (file.type !== "text/plain" && file.type !== "application/pdf")
  )
    throw new TalaDataError("INVALID_INPUT");
  return file.type;
}
export async function fingerprintEvidenceFile(file: File): Promise<string> {
  validateEvidenceFile(file);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function createEvidenceUpload(
  uid: string,
  input: {
    appointmentId: string;
    title: string;
    contentType: EvidenceContentType;
    size: number;
    requestId: string;
    syntheticOnly: true;
    sha256: string;
  },
): Promise<TalaUploadIntent> {
  if (!/^[a-f0-9]{64}$/.test(input.sha256))
    throw new TalaDataError("INVALID_INPUT");
  const value = object(await call(uid, "createTalaEvidenceUpload", input));
  const uploadId = string(value.uploadId);
  const storagePath = string(value.storagePath, 400);
  if (
    !/^[a-f0-9]{64}$/.test(uploadId) ||
    !["txt", "pdf"].some(
      (extension) =>
        storagePath ===
        `${getFirebaseClient().namespace!.evidenceRoot}/${uid}/${uploadId}/document.${extension}`,
    ) ||
    value.maxBytes !== MAX_EVIDENCE_BYTES
  )
    throw new TalaDataError("INVALID_RESPONSE");
  return {
    uploadId,
    storagePath,
    expiresAt: instant(value.expiresAt),
    maxBytes: MAX_EVIDENCE_BYTES,
    sha256: input.sha256,
  };
}

export async function uploadEvidenceFile(
  uid: string,
  intent: TalaUploadIntent,
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new TalaDataError("CANCELLED");
  const contentType = validateEvidenceFile(file);
  const sha256 = await fingerprintEvidenceFile(file);
  if (signal.aborted) throw new TalaDataError("CANCELLED");
  if (intent.sha256 !== sha256) throw new TalaDataError("CONFLICT");
  const client = await isolatedClient(uid);
  if (
    !/^[a-f0-9]{64}$/.test(intent.uploadId) ||
    intent.storagePath !==
      `${client.namespace!.evidenceRoot}/${uid}/${intent.uploadId}/document.${contentType === "application/pdf" ? "pdf" : "txt"}` ||
    intent.maxBytes !== MAX_EVIDENCE_BYTES
  )
    throw new TalaDataError("INVALID_INPUT");
  if (signal.aborted) throw new TalaDataError("CANCELLED");
  // The UI never requests a public URL. Staging Firebase bearer tokens are not
  // revoked until server promotion; finalized evidence is server-only. The
  // owner-authorized callable checks actual bytes and recovers completed replies.
  const status = await call(uid, "getTalaEvidenceUploadStatus", {
    uploadId: intent.uploadId,
  })
    .then((raw) =>
      validateEvidenceUploadStatus(raw, {
        uploadId: intent.uploadId,
        sha256,
        size: file.size,
        contentType,
      }),
    )
    .catch((error: unknown) => {
      throw safeTalaDataError(error);
    });
  if (signal.aborted) throw new TalaDataError("CANCELLED");
  if (status.status === "submitted") {
    onProgress(100);
    return;
  }
  if (
    !Number.isFinite(Date.parse(intent.expiresAt)) ||
    Date.parse(intent.expiresAt) <= Date.now()
  )
    throw new TalaDataError("EXPIRED");
  if (status.status === "uploaded") {
    onProgress(100);
    return;
  }
  const fileRef = ref(client.storage, intent.storagePath);
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(fileRef, file, {
      contentType,
      customMetadata: { sha256 },
    });
    const abort = () => task.cancel();
    signal.addEventListener("abort", abort, { once: true });
    task.on(
      "state_changed",
      (snapshot) => {
        if (client.auth.currentUser?.uid !== uid || signal.aborted) {
          task.cancel();
          return;
        }
        onProgress(
          Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
        );
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(safeTalaDataError(error));
      },
      () => {
        signal.removeEventListener("abort", abort);
        try {
          requireOwner(client, uid);
          resolve();
        } catch (error) {
          reject(error);
        }
      },
    );
    if (signal.aborted) abort();
  });
}
export async function submitEvidence(
  uid: string,
  input: { uploadId: string; requestId: string },
): Promise<{ evidence: TalaEvidence; progress: TalaProgress }> {
  const value = object(await call(uid, "submitTalaEvidence", input));
  const item = object(value.evidence);
  if (item.id !== input.uploadId) throw new TalaDataError("INVALID_RESPONSE");
  return {
    evidence: evidence(string(item.id), item, uid),
    progress: progress(value.progress, uid),
  };
}

export async function readTalaLearningRecords(
  uid: string,
): Promise<TalaLearningRecords> {
  const value = object(await call(uid, "getTalaLearningRecords", {}));
  const integrations = object(value.integrations);
  if (integrations.zoom !== "unavailable" || integrations.ai !== "unavailable")
    throw new TalaDataError("INVALID_RESPONSE");
  const records = array(value.records, 100).map((raw): TalaLearningRecord => {
    const record = object(raw);
    if (
      record.status !== "published" ||
      !["confirmed", "not_recorded"].includes(String(record.attendance))
    )
      throw new TalaDataError("INVALID_RESPONSE");
    const outcomes = array(record.outcomes, 30).map(
      (rawOutcome): TalaLearningOutcome => {
        const outcome = object(rawOutcome);
        if (
          outcome.status !== "published" ||
          !["staff", "authorized_ai"].includes(String(outcome.source))
        )
          throw new TalaDataError("INVALID_RESPONSE");
        return {
          id: string(outcome.id),
          summary: string(outcome.summary, 2000),
          status: "published",
          source: outcome.source as TalaLearningOutcome["source"],
          publishedAt: instant(outcome.publishedAt),
        };
      },
    );
    const acknowledgedOutcomeIds = array(record.acknowledgedOutcomeIds, 30).map(
      (id) => string(id),
    );
    if (
      new Set(outcomes.map((outcome) => outcome.id)).size !== outcomes.length ||
      new Set(acknowledgedOutcomeIds).size !== acknowledgedOutcomeIds.length ||
      acknowledgedOutcomeIds.some(
        (id) => !outcomes.some((outcome) => outcome.id === id),
      )
    )
      throw new TalaDataError("INVALID_RESPONSE");
    return {
      id: string(record.id),
      appointmentId: string(record.appointmentId),
      status: "published",
      attendance: record.attendance as TalaLearningRecord["attendance"],
      outcomes,
      acknowledgedOutcomeIds,
      updatedAt: instant(record.updatedAt),
    };
  });
  if (new Set(records.map((record) => record.id)).size !== records.length)
    throw new TalaDataError("INVALID_RESPONSE");
  return { records, integrations: { zoom: "unavailable", ai: "unavailable" } };
}

export async function acknowledgeTalaOutcome(
  uid: string,
  input: { recordId: string; outcomeId: string; requestId: string },
): Promise<{
  recordId: string;
  outcomeId: string;
  acknowledgedAt: string;
  progress: TalaProgress;
}> {
  const value = object(await call(uid, "acknowledgeTalaOutcome", input));
  if (value.recordId !== input.recordId || value.outcomeId !== input.outcomeId)
    throw new TalaDataError("INVALID_RESPONSE");
  return {
    recordId: string(value.recordId),
    outcomeId: string(value.outcomeId),
    acknowledgedAt: instant(value.acknowledgedAt),
    progress: progress(value.progress, uid),
  };
}

export async function getTalaFamilyLinks(
  uid: string,
): Promise<TalaFamilyLinks> {
  const value = object(await call(uid, "getTalaFamilyLinks", {}));
  const relationships = array(value.relationships, 100).map(
    (raw): TalaFamilyLinks["relationships"][number] => {
      const link = object(raw);
      if (
        link.status !== "active" ||
        link.consent !== "recorded" ||
        (link.studentUid !== uid && link.parentUid !== uid) ||
        link.studentUid === link.parentUid
      )
        throw new TalaDataError("INVALID_RESPONSE");
      return {
        id: string(link.id),
        studentUid: string(link.studentUid),
        parentUid: string(link.parentUid),
        status: "active",
        consent: "recorded",
      };
    },
  );
  const linkedProfiles = array(value.linkedProfiles, 200).map(
    (raw): TalaFamilyLinks["linkedProfiles"][number] => {
      const profile = object(raw);
      if (
        !["student", "parent"].includes(String(profile.role)) ||
        !relationships.some(
          (link) =>
            link.studentUid === profile.uid || link.parentUid === profile.uid,
        )
      )
        throw new TalaDataError("INVALID_RESPONSE");
      return {
        uid: string(profile.uid),
        role: profile.role as "student" | "parent",
        displayName: string(profile.displayName, 80),
      };
    },
  );
  return { relationships, linkedProfiles };
}

/** Every listener is owner-scoped, cancellable, and ignored after identity changes. */
export function subscribeTalaWorkspace(
  uid: string,
  onChange: (snapshot: TalaWorkspaceSnapshot) => void,
  onError: (error: TalaDataError) => void,
): () => void {
  let active = true;
  let failed = false;
  let ownerClient: FirebaseClient | undefined;
  const unsubscribers: Array<() => void> = [];
  const received = new Set<string>();
  const cached = new Map<string, boolean>();
  let snapshot: TalaWorkspaceSnapshot = {
    slots: [],
    appointments: [],
    activeAppointments: [],
    evidence: [],
    progress: {
      submittedEvidenceCount: 0,
      assessedEvidenceCount: 0,
      acknowledgedOutcomeCount: 0,
      masteryStatus: "unavailable",
    },
    loading: true,
    fromCache: true,
  };
  const update = (
    key: string,
    fromCache: boolean,
    change: Partial<TalaWorkspaceSnapshot>,
  ) => {
    if (!active || failed || ownerClient?.auth.currentUser?.uid !== uid) return;
    received.add(key);
    cached.set(key, fromCache);
    snapshot = {
      ...snapshot,
      ...change,
      loading: received.size !== 5,
      fromCache: [...cached.values()].some(Boolean),
    };
    onChange(snapshot);
  };
  const fail = (error: unknown) => {
    if (
      active &&
      !failed &&
      (!ownerClient || ownerClient.auth.currentUser?.uid === uid)
    ) {
      failed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      onError(safeTalaDataError(error));
    }
  };
  void isolatedClient(uid)
    .then((client) => {
      if (!active) return;
      ownerClient = client;
      unsubscribers.push(
        onSnapshot(
          query(
            collection(
              client.db,
              `${client.namespace!.collectionsPrefix}slots`,
            ),
            where("isAvailable", "==", true),
            where("startAt", ">", Timestamp.now()),
            orderBy("startAt", "asc"),
            limit(50),
          ),
          { includeMetadataChanges: true },
          (result) => {
            try {
              const slots = result.docs
                .map((item): TalaSlot => {
                  const value = item.data();
                  return {
                    id: item.id,
                    startsAt: instant(value.startAt),
                    endsAt: instant(value.endAt),
                  };
                })
                .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
              update("slots", result.metadata.fromCache, { slots });
            } catch (error) {
              fail(error);
            }
          },
          fail,
        ),
      );
      unsubscribers.push(
        onSnapshot(
          query(
            collection(
              client.db,
              `${client.namespace!.collectionsPrefix}appointments`,
            ),
            where("ownerUid", "==", uid),
            limit(100),
          ),
          { includeMetadataChanges: true },
          (result) => {
            try {
              const appointments = result.docs
                .map((item) => appointment(item.id, item.data(), uid))
                .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
              update("appointments", result.metadata.fromCache, {
                appointments,
              });
            } catch (error) {
              fail(error);
            }
          },
          fail,
        ),
      );
      unsubscribers.push(
        onSnapshot(
          query(
            collection(
              client.db,
              `${client.namespace!.collectionsPrefix}appointments`,
            ),
            where("ownerUid", "==", uid),
            where("status", "==", "reserved"),
            limit(1),
          ),
          { includeMetadataChanges: true },
          (result) => {
            try {
              update("active-appointments", result.metadata.fromCache, {
                activeAppointments: result.docs.map((item) =>
                  appointment(item.id, item.data(), uid),
                ),
              });
            } catch (error) {
              fail(error);
            }
          },
          fail,
        ),
      );
      unsubscribers.push(
        onSnapshot(
          query(
            collection(
              client.db,
              `${client.namespace!.collectionsPrefix}evidence`,
            ),
            where("ownerUid", "==", uid),
            limit(100),
          ),
          { includeMetadataChanges: true },
          (result) => {
            try {
              const items = result.docs
                .map((item) => evidence(item.id, item.data(), uid))
                .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
              update("evidence", result.metadata.fromCache, {
                evidence: items,
              });
            } catch (error) {
              fail(error);
            }
          },
          fail,
        ),
      );
      unsubscribers.push(
        onSnapshot(
          doc(client.db, `${client.namespace!.collectionsPrefix}progress`, uid),
          { includeMetadataChanges: true },
          (result) => {
            try {
              update("progress", result.metadata.fromCache, {
                progress: result.exists()
                  ? progress(result.data(), uid)
                  : {
                      submittedEvidenceCount: 0,
                      assessedEvidenceCount: 0,
                      acknowledgedOutcomeCount: 0,
                      masteryStatus: "unavailable",
                    },
              });
            } catch (error) {
              fail(error);
            }
          },
          fail,
        ),
      );
    })
    .catch(fail);
  return () => {
    active = false;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}
