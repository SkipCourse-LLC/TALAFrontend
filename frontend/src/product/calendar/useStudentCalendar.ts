import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  newRequestId,
  safeTalaApiError,
  talaApi,
  TalaApiError,
} from "../../api";
import {
  announceClassChange,
  useClassWorkspaceRevision,
} from "./classWorkspaceSync";
import type {
  CalendarClass,
  StudentCalendar,
} from "../../api/calendarContract";

type EnrollmentIntent = {
  classId: string;
  action: "enroll" | "cancel" | "update";
  requestId: string;
  mode?: "online" | "in_person";
  goalId?: string | null;
  expectedVersion?: number;
};

type CalendarSnapshot = {
  ownerUid: string;
  identity: object;
  epoch: number;
  data?: StudentCalendar;
  catalog?: CalendarClass[];
  loading: boolean;
  error: string;
  notice: string;
  busyClassId: string | null;
};

const uncertainCodes = new Set([
  "NETWORK",
  "UNAVAILABLE",
  "INVALID_RESPONSE",
  "INTERNAL_ERROR",
  "CANCELLED",
]);

function currentPhoenixMonth() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
}

function mergeEnrollment(data: StudentCalendar, item: CalendarClass) {
  return {
    ...data,
    classes: data.classes.map((previous) =>
      previous.id === item.id ? item : previous,
    ),
    enrolled: [
      ...data.enrolled.filter((previous) => previous.id !== item.id),
      ...(item.enrolled ? [item] : []),
    ].sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
    ),
  };
}

function sameOwner(previous: CalendarSnapshot, owner: string, epoch: number) {
  return previous.ownerUid === owner && previous.epoch === epoch;
}

/** One account-bound snapshot powers Calendar, Overview and Progress. */
export function useStudentCalendar({
  ownerUid,
  enabled,
  revision,
  onExpired,
}: {
  ownerUid: string;
  enabled: boolean;
  revision: number;
  onExpired: () => void;
}) {
  const identityToken = useMemo(
    () => ({ ownerUid, enabled }),
    [ownerUid, enabled],
  );
  const classRevision = useClassWorkspaceRevision(enabled);
  const [month, updateMonth] = useState(currentPhoenixMonth);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<CalendarSnapshot>({
    ownerUid,
    identity: identityToken,
    epoch: 0,
    loading: false,
    error: "",
    notice: "",
    busyClassId: null,
  });
  const active = useRef(false);
  const identity = useRef(enabled ? ownerUid : "");
  const identityEpoch = useRef(0);
  const readEpoch = useRef(0);
  const mutationEpoch = useRef(0);
  const readRequest = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const intents = useRef(new Map<string, EnrollmentIntent>());
  const latest = useRef({ ownerUid, enabled, month, onExpired, identityToken });

  useLayoutEffect(() => {
    latest.current = { ownerUid, enabled, month, onExpired, identityToken };
    const nextIdentity = enabled ? ownerUid : "";
    if (identity.current !== nextIdentity) {
      identity.current = nextIdentity;
      identityEpoch.current++;
      readEpoch.current++;
      mutationEpoch.current++;
      readRequest.current?.abort();
      mutation.current?.abort();
      readRequest.current = null;
      mutation.current = null;
      intents.current.clear();
    }
  }, [ownerUid, enabled, month, onExpired, identityToken]);

  useLayoutEffect(() => {
    active.current = true;
    const epoch = identityEpoch;
    const pendingIntents = intents.current;
    return () => {
      active.current = false;
      epoch.current++;
      readRequest.current?.abort();
      mutation.current?.abort();
      mutation.current = null;
      pendingIntents.clear();
    };
  }, []);

  // Retire a query before passive cleanup, including a navigation during a write.
  useLayoutEffect(() => {
    const epoch = readEpoch;
    return () => {
      epoch.current++;
      readRequest.current?.abort();
      readRequest.current = null;
    };
  }, [ownerUid, enabled, month, revision, attempt, classRevision]);

  const reload = useCallback(async (preserveError = false) => {
    const context = latest.current;
    if (
      !active.current ||
      !context.enabled ||
      !context.ownerUid ||
      mutation.current
    )
      return;
    const owner = context.ownerUid;
    const ownerVersion = identityEpoch.current;
    const readVersion = ++readEpoch.current;
    const writeVersion = mutationEpoch.current;
    readRequest.current?.abort();
    const request = new AbortController();
    readRequest.current = request;
    const current = () =>
      active.current &&
      latest.current.enabled &&
      latest.current.ownerUid === owner &&
      ownerVersion === identityEpoch.current &&
      readVersion === readEpoch.current &&
      writeVersion === mutationEpoch.current &&
      !request.signal.aborted;
    setSnapshot((previous) => ({
      ...(sameOwner(previous, owner, ownerVersion)
        ? previous
        : { ownerUid: owner }),
      identity: context.identityToken,
      epoch: ownerVersion,
      loading: true,
      error:
        (preserveError || intents.current.size > 0) &&
        sameOwner(previous, owner, ownerVersion)
          ? previous.error
          : "",
      notice: sameOwner(previous, owner, ownerVersion) ? previous.notice : "",
      busyClassId: null,
    }));
    try {
      const [data, catalog] = await Promise.all([
        talaApi.getStudentCalendar(context.month, request.signal),
        talaApi.getClasses(undefined, request.signal),
      ]);
      if (!current()) return;
      let confirmedAction: EnrollmentIntent["action"] | undefined;
      for (const [classId, intent] of intents.current) {
        const saved = data.enrolled.find((item) => item.id === classId);
        const confirmed =
          intent.action === "cancel"
            ? !saved
            : intent.action === "update"
              ? Boolean(
                  saved &&
                  saved.enrollmentVersion! > (intent.expectedVersion ?? 0) &&
                  saved.enrollmentMode === intent.mode &&
                  (saved.enrollmentGoalId ?? null) === (intent.goalId ?? null),
                )
              : Boolean(saved);
        if (confirmed) {
          intents.current.delete(classId);
          confirmedAction = intent.action;
        }
      }
      setSnapshot((previous) => ({
        ownerUid: owner,
        identity: context.identityToken,
        epoch: ownerVersion,
        data,
        catalog: catalog.classes.length
          ? catalog.classes
          : data.classes.filter((item) => item.source === "test_catalog"),
        loading: false,
        busyClassId: null,
        error: intents.current.size
          ? "The last action is not confirmed. Retry the same action to check."
          : !confirmedAction &&
              preserveError &&
              sameOwner(previous, owner, ownerVersion)
            ? previous.error
            : "",
        notice: intents.current.size
          ? ""
          : confirmedAction
            ? confirmedAction === "update"
              ? "Request changes saved."
              : confirmedAction === "enroll"
                ? "Class request saved. Check its status below."
                : "Class request cancelled."
            : sameOwner(previous, owner, ownerVersion)
              ? previous.notice
              : "",
      }));
      return data;
    } catch (failure) {
      if (!current()) return;
      const problem = safeTalaApiError(failure);
      const expired =
        problem.code === "AUTH_REQUIRED" || problem.code === "FORBIDDEN";
      setSnapshot((previous) => ({
        ...(sameOwner(previous, owner, ownerVersion)
          ? previous
          : { ownerUid: owner }),
        identity: context.identityToken,
        epoch: ownerVersion,
        catalog:
          !expired && sameOwner(previous, owner, ownerVersion)
            ? previous.catalog
            : undefined,
        data: expired
          ? undefined
          : sameOwner(previous, owner, ownerVersion)
            ? previous.data
            : undefined,
        loading: false,
        error: problem.message,
        notice: "",
        busyClassId: null,
      }));
      if (expired) latest.current.onExpired();
    } finally {
      if (readRequest.current === request) readRequest.current = null;
      if (current())
        setSnapshot((previous) => ({ ...previous, loading: false }));
    }
  }, []);

  useEffect(() => {
    const start = window.setTimeout(() => {
      if (enabled && ownerUid) void reload();
      else
        setSnapshot({
          ownerUid,
          identity: identityToken,
          epoch: identityEpoch.current,
          loading: false,
          error: "",
          notice: "",
          busyClassId: null,
        });
    }, 0);
    return () => window.clearTimeout(start);
  }, [
    ownerUid,
    enabled,
    month,
    revision,
    attempt,
    classRevision,
    reload,
    identityToken,
  ]);

  const execute = useCallback(
    async (
      classId: string,
      action: "enroll" | "cancel" | "update",
      mode?: "online" | "in_person",
      goalId?: string | null,
      expectedVersion?: number,
    ) => {
      const context = latest.current;
      if (
        !active.current ||
        !context.enabled ||
        !context.ownerUid ||
        mutation.current
      )
        return false;
      const pending = intents.current.get(classId);
      if (
        pending &&
        (pending.action !== action ||
          (action === "update" &&
            (pending.mode !== mode ||
              pending.goalId !== goalId ||
              pending.expectedVersion !== expectedVersion)))
      ) {
        setSnapshot((previous) => ({
          ...previous,
          error: "Check your saved classes before changing this enrollment.",
          notice: "",
        }));
        void reload();
        return false;
      }
      const owner = context.ownerUid;
      const ownerVersion = identityEpoch.current;
      const request = new AbortController();
      // Assign before the first await, so rapid clicks cannot create two writes.
      mutation.current = request;
      mutationEpoch.current++;
      readEpoch.current++;
      readRequest.current?.abort();
      readRequest.current = null;
      const intent = pending ?? {
        classId,
        action,
        requestId: newRequestId(),
        mode,
        goalId,
        expectedVersion,
      };
      intents.current.set(classId, intent);
      const current = () =>
        active.current &&
        latest.current.enabled &&
        latest.current.ownerUid === owner &&
        ownerVersion === identityEpoch.current &&
        !request.signal.aborted;
      setSnapshot((previous) => ({
        ...(sameOwner(previous, owner, ownerVersion)
          ? previous
          : { ownerUid: owner }),
        identity: context.identityToken,
        epoch: ownerVersion,
        loading: false,
        error: "",
        notice: "",
        busyClassId: classId,
      }));
      let refresh = false;
      let preserveError = false;
      try {
        const result =
          action === "update"
            ? await talaApi.updateClassRequest(
                {
                  classId,
                  mode: intent.mode!,
                  goalId: intent.goalId ?? null,
                  expectedVersion: intent.expectedVersion!,
                },
                intent.requestId,
                request.signal,
              )
            : action === "enroll"
              ? await talaApi.enrollCalendarClass(
                  classId,
                  intent.requestId,
                  request.signal,
                  intent.mode,
                  intent.goalId ?? undefined,
                )
              : await talaApi.cancelCalendarClass(
                  classId,
                  intent.requestId,
                  request.signal,
                );
        if (!current()) return false;
        if (
          result.class.id !== classId ||
          result.class.enrolled !== (action !== "cancel")
        )
          throw new TalaApiError("INVALID_RESPONSE");
        intents.current.delete(classId);
        setSnapshot((previous) => ({
          ownerUid: owner,
          identity: context.identityToken,
          epoch: ownerVersion,
          data:
            sameOwner(previous, owner, ownerVersion) && previous.data
              ? mergeEnrollment(previous.data, result.class)
              : undefined,
          catalog: sameOwner(previous, owner, ownerVersion)
            ? previous.catalog?.map((item) =>
                item.id === result.class.id ? result.class : item,
              )
            : undefined,
          loading: false,
          error: "",
          notice:
            action === "update"
              ? "Request updated. Your place in the request queue is kept."
              : action === "enroll"
                ? "Class request saved. Check its status below."
                : "Class request cancelled.",
          busyClassId: null,
        }));
        refresh = true;
        announceClassChange();
        return true;
      } catch (failure) {
        if (!current()) return false;
        const problem = safeTalaApiError(failure);
        preserveError = true;
        const uncertain = uncertainCodes.has(problem.code);
        if (!uncertain) intents.current.delete(classId);
        const expired =
          problem.code === "AUTH_REQUIRED" || problem.code === "FORBIDDEN";
        setSnapshot((previous) => ({
          ...(sameOwner(previous, owner, ownerVersion)
            ? previous
            : { ownerUid: owner }),
          identity: context.identityToken,
          epoch: ownerVersion,
          catalog:
            !expired && sameOwner(previous, owner, ownerVersion)
              ? previous.catalog
              : undefined,
          data: expired
            ? undefined
            : sameOwner(previous, owner, ownerVersion)
              ? previous.data
              : undefined,
          loading: false,
          busyClassId: null,
          error:
            problem.code === "CONFLICT"
              ? "This class changed or is full. Refresh and try another."
              : problem.message,
          notice: uncertain
            ? "Not confirmed. Checking your saved classes…"
            : "",
        }));
        if (expired) latest.current.onExpired();
        refresh = !expired;
        return false;
      } finally {
        if (mutation.current === request) mutation.current = null;
        if (current()) {
          setSnapshot((previous) => ({ ...previous, busyClassId: null }));
          if (refresh) void reload(preserveError);
        }
      }
    },
    [reload],
  );

  const setMonth = useCallback((value: string) => {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) updateMonth(value);
  }, []);
  const retry = useCallback(() => setAttempt((previous) => previous + 1), []);
  const enroll = useCallback(
    (classId: string, mode?: "online" | "in_person", goalId?: string) =>
      execute(classId, "enroll", mode, goalId),
    [execute],
  );
  const updateRequest = useCallback(
    (
      classId: string,
      mode: "online" | "in_person",
      goalId: string | null,
      expectedVersion: number,
    ) => execute(classId, "update", mode, goalId, expectedVersion),
    [execute],
  );
  const cancel = useCallback(
    (classId: string) => execute(classId, "cancel"),
    [execute],
  );
  const own =
    enabled &&
    snapshot.identity === identityToken &&
    snapshot.ownerUid === ownerUid;
  const data =
    own && snapshot.data?.month === month ? snapshot.data : undefined;
  return {
    data,
    catalog: own ? snapshot.catalog : undefined,
    month,
    setMonth,
    loading:
      enabled && (own ? snapshot.loading || (!data && !snapshot.error) : true),
    error: own ? snapshot.error : "",
    busyClassId: own ? snapshot.busyClassId : null,
    notice: own ? snapshot.notice : "",
    retry,
    enroll,
    cancel,
    updateRequest,
  };
}
