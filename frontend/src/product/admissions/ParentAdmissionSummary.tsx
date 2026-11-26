import { useCallback, useEffect, useState } from "react";
import { admissionsApi, safeTalaApiError } from "../../api";
import type { AdmissionApplication } from "../../api";
import { admissionStatusLabel } from "./admissionsDisplay";
import { StudentAccountSetup } from "./StudentAccountSetup";
import { useClassWorkspaceRevision } from "../calendar/classWorkspaceSync";
import "./admissionsReview.css";

export function ParentAdmissionSummary({
  ownerUid,
  onExpired,
  onStudentProvisioned,
  onSetupDraftChange,
  onSetupBusyChange,
}: {
  ownerUid: string;
  onExpired: () => void;
  onStudentProvisioned: (studentUid: string) => void;
  onSetupDraftChange?: (dirty: boolean) => void;
  onSetupBusyChange?: (busy: boolean) => void;
}) {
  const revision = useClassWorkspaceRevision();
  const [saved, setSaved] = useState<{
    ownerUid: string;
    applications: AdmissionApplication[];
    error: string;
  }>();
  const [attempt, setAttempt] = useState(0);
  const [statusRevision, setStatusRevision] = useState(0);
  const [activity, setActivity] = useState<
    Record<string, { dirty: boolean; busy: boolean }>
  >({});
  const setApplicationActivity = useCallback(
    (id: string, kind: "dirty" | "busy", value: boolean) => {
      setActivity((previous) => {
        const current = previous[id] ?? { dirty: false, busy: false };
        return current[kind] === value
          ? previous
          : { ...previous, [id]: { ...current, [kind]: value } };
      });
    },
    [],
  );
  const dirty = Object.values(activity).some((item) => item.dirty);
  const busy = Object.values(activity).some((item) => item.busy);
  useEffect(() => {
    onSetupDraftChange?.(dirty);
    return () => onSetupDraftChange?.(false);
  }, [dirty, onSetupDraftChange]);
  useEffect(() => {
    onSetupBusyChange?.(busy);
    return () => onSetupBusyChange?.(false);
  }, [busy, onSetupBusyChange]);
  const checkStatus = useCallback(() => setAttempt((value) => value + 1), []);
  const saveApplication = useCallback(
    (application: AdmissionApplication) => {
      setSaved((previous) =>
        previous?.ownerUid === ownerUid
          ? {
              ...previous,
              applications: previous.applications.map((item) =>
                item.id === application.id ? application : item,
              ),
            }
          : previous,
      );
    },
    [ownerUid],
  );
  useEffect(() => {
    const request = new AbortController();
    void admissionsApi
      .parentApplications(request.signal)
      .then((result) => {
        if (!request.signal.aborted) {
          setSaved((previous) => ({
            ownerUid,
            applications: result.applications.map((application) => {
              const newer =
                previous?.ownerUid === ownerUid
                  ? previous.applications.find(
                      (item) =>
                        item.id === application.id &&
                        item.version > application.version,
                    )
                  : undefined;
              return newer ?? application;
            }),
            error: "",
          }));
          setStatusRevision((value) => value + 1);
        }
      })
      .catch((failure) => {
        if (request.signal.aborted) return;
        const problem = safeTalaApiError(failure);
        if (problem.code === "AUTH_REQUIRED" || problem.code === "FORBIDDEN")
          onExpired();
        else
          setSaved((previous) =>
            previous?.ownerUid === ownerUid
              ? { ...previous, error: problem.message }
              : { ownerUid, applications: [], error: problem.message },
          );
      });
    return () => request.abort();
  }, [ownerUid, attempt, revision, onExpired]);
  if (saved?.ownerUid !== ownerUid)
    return <p role="status">Loading admission details…</p>;
  if (saved.error && !saved.applications.length)
    return (
      <section className="parent-admission-summary">
        <h2>Enrollment</h2>
        <p role="alert">{saved.error}</p>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry
        </button>
      </section>
    );
  if (!saved.applications.length) return null;
  return (
    <section
      className="parent-admission-summary"
      aria-labelledby="parent-admission-heading"
    >
      <div className="parent-enrollment-heading">
        <h2 id="parent-admission-heading">Family setup</h2>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={checkStatus}
        >
          Refresh setup
        </button>
      </div>
      {saved.error && (
        <p className="admissions-error" role="alert">
          {saved.error} Your entered details remain in this tab. Use Refresh
          setup to retry.
        </p>
      )}
      {saved.applications.map((application) => (
        <ParentApplicationCard
          key={application.id}
          application={application}
          statusRevision={statusRevision}
          onSaved={saveApplication}
          onProvisioned={onStudentProvisioned}
          onCheckStatus={checkStatus}
          onExpired={onExpired}
          onActivity={setApplicationActivity}
        />
      ))}
    </section>
  );
}

function ParentApplicationCard({
  application,
  statusRevision,
  onSaved,
  onProvisioned,
  onCheckStatus,
  onExpired,
  onActivity,
}: {
  application: AdmissionApplication;
  statusRevision: number;
  onSaved: (application: AdmissionApplication) => void;
  onProvisioned: (studentUid: string) => void;
  onCheckStatus: () => void;
  onExpired: () => void;
  onActivity: (id: string, kind: "dirty" | "busy", value: boolean) => void;
}) {
  const onDraftChange = useCallback(
    (value: boolean) => onActivity(application.id, "dirty", value),
    [application.id, onActivity],
  );
  const onBusyChange = useCallback(
    (value: boolean) => onActivity(application.id, "busy", value),
    [application.id, onActivity],
  );
  return (
    <article>
      <header>
        <h3>{application.studentName || application.parentName}</h3>
        <span className="admissions-status">
          {application.studentSetup?.status === "provisioned"
            ? "Student account ready"
            : admissionStatusLabel[application.status]}
        </span>
      </header>
      {application.status === "enrolled" && (
        <StudentAccountSetup
          application={application}
          statusRevision={statusRevision}
          onSaved={onSaved}
          onProvisioned={onProvisioned}
          onCheckStatus={onCheckStatus}
          onExpired={onExpired}
          onDraftChange={onDraftChange}
          onBusyChange={onBusyChange}
        />
      )}
    </article>
  );
}
