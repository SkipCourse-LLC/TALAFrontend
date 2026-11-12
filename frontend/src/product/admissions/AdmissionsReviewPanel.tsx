import { useEffect, useRef, useState } from "react";
import {
  admissionsApi,
  newRequestId,
  safeTalaApiError,
  TalaApiError,
} from "../../api";
import type { AdmissionApplication, AdmissionDetail } from "../../api";
import { usePrivateWorkspaceExport } from "../usePrivateWorkspaceExport";
import { parseLocalMeetingTime } from "../meetingHelpers";
import { admissionStatusLabel } from "./admissionsDisplay";
import {
  announceClassChange,
  useClassWorkspaceRevision,
} from "../calendar/classWorkspaceSync";
import "./admissionsReview.css";
import "./studentAccountSetup.css";

const interviewTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Phoenix",
  }).format(new Date(value));

type ReviewProps = {
  operatorUid: string;
  attempt: number;
  onExpired: () => void;
};

export function AdmissionsReviewPanel(props: ReviewProps) {
  return <AdmissionsReviewSession key={props.operatorUid} {...props} />;
}

function AdmissionsReviewSession({
  operatorUid,
  attempt,
  onExpired,
}: ReviewProps) {
  const workspaceRevision = useClassWorkspaceRevision();
  const [applications, setApplications] = useState<AdmissionApplication[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<AdmissionDetail>();
  const [ready, setReady] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notes, setNotes] = useState("");
  const [completed, setCompleted] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [confirmStudentSetup, setConfirmStudentSetup] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [invitation, setInvitation] = useState<{
    applicationId: string;
    url: string;
    expiresAt: string;
  }>();
  const lifecycle = useRef({ active: false, generation: 0 });
  const mutation = useRef<AbortController | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const exportDocument = usePrivateWorkspaceExport();
  const errorBox = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const state = lifecycle.current;
    const pendingIds = requestIds.current;
    state.active = true;
    return () => {
      state.active = false;
      state.generation++;
      mutation.current?.abort();
      pendingIds.clear();
    };
  }, [operatorUid]);

  const report = (failure: unknown) => {
    const problem = safeTalaApiError(failure);
    if (problem.code === "AUTH_REQUIRED" || problem.code === "FORBIDDEN")
      onExpired();
    else setError(problem.message);
  };

  useEffect(() => {
    const request = new AbortController();
    void admissionsApi
      .listApplications(request.signal)
      .then((result) => {
        if (request.signal.aborted) return;
        setApplications((previous) =>
          result.applications.map((item) => {
            const newer = previous.find(
              (saved) => saved.id === item.id && saved.version > item.version,
            );
            return newer ?? item;
          }),
        );
        setSelectedId((id) =>
          result.applications.some((item) => item.id === id)
            ? id
            : (result.applications[0]?.id ?? ""),
        );
        setReady(true);
      })
      .catch((failure) => {
        if (request.signal.aborted) return;
        const problem = safeTalaApiError(failure);
        if (problem.code === "AUTH_REQUIRED" || problem.code === "FORBIDDEN")
          onExpired();
        else {
          setReady(true);
          setError(problem.message);
        }
      });
    return () => request.abort();
  }, [operatorUid, attempt, refresh, workspaceRevision, onExpired]);

  useEffect(() => {
    const request = new AbortController();
    if (selectedId)
      void admissionsApi
        .applicationDetail(selectedId, request.signal)
        .then((result) => {
          if (request.signal.aborted) return;
          setDetail((previous) =>
            previous?.application.id === result.application.id &&
            previous.application.version > result.application.version
              ? previous
              : result,
          );
        })
        .catch((failure) => {
          if (request.signal.aborted) return;
          const problem = safeTalaApiError(failure);
          if (problem.code === "AUTH_REQUIRED" || problem.code === "FORBIDDEN")
            onExpired();
          else setError(problem.message);
        });
    return () => request.abort();
  }, [operatorUid, selectedId, attempt, refresh, workspaceRevision, onExpired]);

  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);

  const current = detail?.application.id === selectedId ? detail : undefined;
  const application = current?.application;

  function select(id: string) {
    if (mutation.current) return;
    setSelectedId(id);
    setNotes("");
    setCompleted(false);
    setConfirmDecline(false);
    setConfirmStudentSetup(false);
    setError("");
    setNotice("");
    setInvitation(undefined);
  }

  async function run(
    key: string,
    action: (signal: AbortSignal, requestId: string) => Promise<void>,
  ) {
    if (mutation.current || !lifecycle.current.active) return;
    const request = new AbortController();
    const state = lifecycle.current;
    const generation = state.generation;
    mutation.current = request;
    setBusy(key);
    setError("");
    setNotice("");
    const requestId = requestIds.current.get(key) ?? newRequestId();
    requestIds.current.set(key, requestId);
    try {
      await action(request.signal, requestId);
      if (
        !state.active ||
        generation !== state.generation ||
        request.signal.aborted
      )
        return;
      requestIds.current.delete(key);
    } catch (failure) {
      if (
        state.active &&
        generation === state.generation &&
        !request.signal.aborted
      ) {
        report(failure);
        if (key.endsWith(":invitation")) {
          setRefresh((value) => value + 1);
          setNotice(
            "No invitation link was received. If one already exists, replace it to create a new link.",
          );
        }
      }
    } finally {
      if (mutation.current === request) mutation.current = null;
      if (state.active && generation === state.generation) setBusy("");
    }
  }

  function review(action: "record_interview" | "approve" | "decline") {
    if (
      !application ||
      (action === "record_interview" && (!completed || !notes.trim()))
    )
      return;
    const id = application.id;
    const version = application.version;
    const submittedNotes = action === "record_interview" ? notes.trim() : "";
    void run(
      `${id}:${version}:${action}:${submittedNotes}`,
      async (signal, requestId) => {
        const result = await admissionsApi.reviewApplication(
          id,
          { action, notes: submittedNotes, version, requestId },
          signal,
        );
        if (signal.aborted || !lifecycle.current.active) return;
        setDetail(result);
        setApplications((items) =>
          items.map((item) => (item.id === id ? result.application : item)),
        );
        setNotice(
          action === "record_interview"
            ? "Interview saved."
            : action === "approve"
              ? "Application approved. Create an enrollment invitation below."
              : "Application declined.",
        );
        setNotes("");
        setCompleted(false);
        setConfirmDecline(false);
        setInvitation(undefined);
      },
    );
  }

  function createInvitation() {
    if (!application || mutation.current) return;
    // A replacement may revoke the previous link even if its response is lost.
    setInvitation(undefined);
    const id = application.id;
    void run(
      `${id}:${application.version}:invitation`,
      async (signal, requestId) => {
        const result = await admissionsApi.issueInvitation(
          id,
          { version: application.version, requestId },
          signal,
        );
        if (signal.aborted || !lifecycle.current.active) return;
        const url = new URL(window.location.href);
        url.search = "";
        url.hash = `/enroll?token=${encodeURIComponent(result.token)}`;
        setInvitation({
          applicationId: id,
          url: url.href,
          expiresAt: result.expiresAt,
        });
        setNotice("One-time invitation created. No email was sent.");
        setRefresh((value) => value + 1);
      },
    );
  }

  function authorizeStudent() {
    if (
      !application ||
      application.status !== "enrolled" ||
      !confirmStudentSetup
    )
      return;
    const id = application.id,
      version = application.version;
    void run(`${id}:${version}:student-setup`, async (signal, requestId) => {
      const result = await admissionsApi.authorizeStudentSetup(
        id,
        { version, requestId },
        signal,
      );
      if (signal.aborted || !lifecycle.current.active) return;
      setDetail(result);
      setApplications((items) =>
        items.map((item) => (item.id === id ? result.application : item)),
      );
      setConfirmStudentSetup(false);
      setNotice(
        "Student setup authorized for seven days. The enrolled parent can now create the student's sign-in details from Family setup. No email was sent.",
      );
      announceClassChange();
    });
  }

  async function copyInvitation() {
    if (!invitation || mutation.current) return;
    try {
      await navigator.clipboard.writeText(invitation.url);
      if (lifecycle.current.active)
        setNotice("Invitation copied. Share it only with this parent.");
    } catch {
      if (lifecycle.current.active)
        setError(
          "Copy is unavailable. Select the invitation link and copy it manually.",
        );
    }
  }

  function publishInterviewTime() {
    const start = parseLocalMeetingTime(startsAt);
    const end = parseLocalMeetingTime(endsAt);
    if (
      !start ||
      !end ||
      start.getTime() <= Date.now() ||
      end.getTime() - start.getTime() < 15 * 60_000 ||
      end.getTime() - start.getTime() > 4 * 60 * 60_000
    ) {
      report(new TalaApiError("INVALID_INPUT"));
      return;
    }
    void run(
      `interview-time:${startsAt}:${endsAt}`,
      async (signal, requestId) => {
        await admissionsApi.addInterviewTime(
          {
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
            label: "Interview with Tina",
            requestId,
          },
          signal,
        );
        if (signal.aborted || !lifecycle.current.active) return;
        setStartsAt("");
        setEndsAt("");
        setNotice(
          "Interview time published for applicants. No external calendar event was created.",
        );
      },
    );
  }

  const canRecord = application?.status === "interview_scheduled";
  const canDecide =
    application?.status === "interviewed" && Boolean(current?.interview);

  return (
    <section
      className="admissions-review"
      aria-labelledby="admissions-review-heading"
    >
      <div className="admissions-heading">
        <div>
          <h2 id="admissions-review-heading">Admissions</h2>
          <p>Interest, interview, then enrollment.</p>
        </div>
        <span className="admissions-environment">Local test environment</span>
      </div>
      {error && (
        <p
          className="admissions-error"
          role="alert"
          ref={errorBox}
          tabIndex={-1}
        >
          {error}{" "}
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => {
              setError("");
              setRefresh((value) => value + 1);
            }}
          >
            Refresh applications
          </button>
        </p>
      )}
      <p className="admissions-notice" role="status" aria-live="polite">
        {notice}
      </p>
      <details className="admissions-availability">
        <summary>Publish an interview time</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            publishInterviewTime();
          }}
        >
          <p className="admissions-caption">
            {Intl.DateTimeFormat().resolvedOptions().timeZone}. 15 minutes–4
            hours. Local test availability.
          </p>
          <div className="admissions-time-fields">
            <label htmlFor="admission-time-start">
              Starts
              <input
                type="datetime-local"
                id="admission-time-start"
                value={startsAt}
                required
                disabled={Boolean(busy)}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </label>
            <label htmlFor="admission-time-end">
              Ends
              <input
                type="datetime-local"
                id="admission-time-end"
                value={endsAt}
                required
                disabled={Boolean(busy)}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            </label>
          </div>
          <button
            type="submit"
            className="button button-secondary"
            disabled={Boolean(busy)}
          >
            {busy.startsWith("interview-time")
              ? "Publishing…"
              : "Publish interview time"}
          </button>
        </form>
      </details>
      {!ready ? (
        <p role="status">Loading applications…</p>
      ) : !applications.length ? (
        <div className="admissions-empty">
          <h3>No applications yet</h3>
          <p>New interest forms will appear here.</p>
        </div>
      ) : (
        <div className="admissions-layout">
          <nav
            className="admissions-queue"
            aria-label="Admissions applications"
          >
            {applications.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-current={selectedId === item.id ? "true" : undefined}
                disabled={Boolean(busy)}
                onClick={() => select(item.id)}
              >
                <strong>
                  <bdi>{item.parentName}</bdi>
                </strong>
                <span>{admissionStatusLabel[item.status]}</span>
              </button>
            ))}
          </nav>
          {!application || !current ? (
            <p role="status">Loading application…</p>
          ) : (
            <article
              className="admissions-detail"
              aria-labelledby="admission-family-name"
              aria-busy={Boolean(busy)}
            >
              <header>
                <div>
                  <h3 id="admission-family-name">
                    <bdi>{application.parentName}</bdi>
                  </h3>
                  <p>
                    <bdi>{application.email}</bdi>
                  </p>
                </div>
                <span className="admissions-status">
                  {admissionStatusLabel[application.status]}
                </span>
              </header>
              <dl className="admissions-facts">
                {application.studentName && (
                  <div>
                    <dt>Student</dt>
                    <dd>
                      <bdi>{application.studentName}</bdi>
                    </dd>
                  </div>
                )}
                {application.gradeBand && (
                  <div>
                    <dt>Grade</dt>
                    <dd>{application.gradeBand}</dd>
                  </div>
                )}
                <div>
                  <dt>Documents</dt>
                  <dd>
                    {application.documentPreference === "bring"
                      ? "Bring to interview"
                      : application.documentPreference === "upload"
                        ? "Upload before interview"
                        : "Not chosen"}
                  </dd>
                </div>
              </dl>
              {application.interest && (
                <section className="admissions-section">
                  <h4>Interest</h4>
                  <p className="admissions-long-text">{application.interest}</p>
                </section>
              )}
              <section className="admissions-section">
                <h4>Interview with Tina</h4>
                {application.appointment ? (
                  <>
                    <p>
                      {interviewTime(application.appointment.startsAt)} –{" "}
                      {new Intl.DateTimeFormat(undefined, {
                        timeStyle: "short",
                        timeZone: "America/Phoenix",
                      }).format(new Date(application.appointment.endsAt))}
                    </p>
                    <p className="admissions-caption">
                      Phoenix time.{" "}
                      {application.appointment.status === "reserved"
                        ? "Local test booking. Meeting link and email are not connected."
                        : "Cancelled."}
                    </p>
                  </>
                ) : (
                  <p>Not booked yet.</p>
                )}
              </section>
              <section className="admissions-section">
                <h4>Private documents</h4>
                {application.documents.length ? (
                  <ul className="admissions-documents">
                    {application.documents.map((document) => (
                      <li key={document.id}>
                        <span>
                          <bdi>{document.name}</bdi>
                          <small>
                            {Math.max(1, Math.ceil(document.size / 1024))} KB
                          </small>
                        </span>
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void run(
                              `download:${document.id}`,
                              async (signal) => {
                                await exportDocument(
                                  (readSignal) =>
                                    admissionsApi.downloadDocument(
                                      document.id,
                                      readSignal,
                                    ),
                                  signal,
                                );
                              },
                            )
                          }
                        >
                          Download
                          <span className="sr-only"> {document.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No files uploaded. Bringing documents is welcome.</p>
                )}
              </section>
              {current.interview && (
                <section className="admissions-section">
                  <h4>Interview record</h4>
                  <p className="admissions-long-text">
                    {current.interview.notes}
                  </p>
                  <p className="admissions-caption">
                    Recorded {interviewTime(current.interview.recordedAt)}
                  </p>
                </section>
              )}
              {(canRecord || canDecide) && (
                <section className="admissions-section admissions-decision">
                  <h4>
                    {canRecord ? "Record interview" : "Enrollment decision"}
                  </h4>
                  {canRecord && (
                    <>
                      <label htmlFor="admission-interview-notes">
                        Interview notes
                      </label>
                      <textarea
                        id="admission-interview-notes"
                        value={notes}
                        maxLength={2000}
                        rows={4}
                        disabled={Boolean(busy)}
                        onChange={(event) => setNotes(event.target.value)}
                      />
                      <label className="admissions-check">
                        <input
                          type="checkbox"
                          checked={completed}
                          disabled={Boolean(busy)}
                          onChange={(event) =>
                            setCompleted(event.target.checked)
                          }
                        />
                        I confirm the interview took place.
                      </label>
                    </>
                  )}
                  <div className="admissions-actions">
                    {canRecord ? (
                      <button
                        type="button"
                        className="button button-primary"
                        disabled={Boolean(busy) || !completed || !notes.trim()}
                        onClick={() => review("record_interview")}
                      >
                        {busy.includes("record_interview")
                          ? "Saving…"
                          : "Save interview"}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="button button-primary"
                          disabled={Boolean(busy)}
                          onClick={() => review("approve")}
                        >
                          Approve application
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={Boolean(busy)}
                          onClick={() => review("decline")}
                        >
                          Decline application
                        </button>
                      </>
                    )}
                  </div>
                </section>
              )}
              {application.status === "pending_interview" && (
                <details className="admissions-section admissions-early-decline">
                  <summary>Decline application before interview</summary>
                  <label className="admissions-check">
                    <input
                      type="checkbox"
                      checked={confirmDecline}
                      disabled={Boolean(busy)}
                      onChange={(event) =>
                        setConfirmDecline(event.target.checked)
                      }
                    />
                    I confirm this application should be declined.
                  </label>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={Boolean(busy) || !confirmDecline}
                    onClick={() => review("decline")}
                  >
                    Confirm decline
                  </button>
                </details>
              )}
              {application.status === "approved" && (
                <section className="admissions-section">
                  <h4>Enrollment invitation</h4>
                  <p>One parent account. One use. Expires automatically.</p>
                  {current.invitation && (
                    <p className="admissions-caption">
                      {current.invitation.usedAt
                        ? "Invitation used."
                        : `Current invitation expires ${interviewTime(current.invitation.expiresAt)}. Replacing it revokes the old link.`}
                    </p>
                  )}
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={Boolean(busy)}
                    onClick={createInvitation}
                  >
                    {busy.includes("invitation")
                      ? "Creating…"
                      : current.invitation
                        ? "Replace invitation"
                        : "Create invitation"}
                  </button>
                  {invitation?.applicationId === application.id && (
                    <div className="admissions-invitation">
                      <label htmlFor="admission-invitation-link">
                        Private one-time link
                      </label>
                      <input
                        id="admission-invitation-link"
                        readOnly
                        value={invitation.url}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => void copyInvitation()}
                      >
                        Copy link
                      </button>
                      <p className="admissions-caption">
                        Expires {interviewTime(invitation.expiresAt)}. No email
                        was sent. The link is shown only in this session.
                      </p>
                    </div>
                  )}
                </section>
              )}
              {application.status === "enrolled" && (
                <section className="admissions-section">
                  <div className="admissions-student-authorization">
                    <h4>Student account setup</h4>
                    <ol className="admissions-setup-steps">
                      <li data-complete="true">
                        ✓ Approved parent account created
                      </li>
                      <li data-complete={Boolean(application.studentSetup)}>
                        {" "}
                        {application.studentSetup ? "✓" : "○"} Staff authorizes
                        student setup
                      </li>
                      <li
                        data-complete={
                          application.studentSetup?.status === "provisioned"
                        }
                      >
                        {application.studentSetup?.status === "provisioned"
                          ? "✓"
                          : "○"}{" "}
                        Parent creates student account and consents to family
                        access
                      </li>
                    </ol>
                    {application.studentSetup?.status === "provisioned" ? (
                      <>
                        <p>
                          <strong>
                            {application.studentSetup.student?.name ??
                              application.studentName}
                          </strong>{" "}
                          has a separate student account and a recorded family
                          connection.
                        </p>
                        {application.studentSetup.student?.email && (
                          <p className="admissions-caption">
                            Student login:{" "}
                            <bdi>{application.studentSetup.student.email}</bdi>
                          </p>
                        )}
                        <p className="admissions-caption">
                          Passwords are chosen by the parent and are never shown
                          to staff.
                        </p>
                      </>
                    ) : application.studentSetup?.status === "authorized" &&
                      Date.parse(application.studentSetup.expiresAt) >
                        Date.now() ? (
                      <>
                        <p>
                          The parent can now sign in and open{" "}
                          <strong>Family setup</strong> to choose student
                          credentials.
                        </p>
                        <p className="admissions-caption">
                          Expires{" "}
                          {interviewTime(application.studentSetup.expiresAt)}{" "}
                          (Phoenix time). No invitation or email delivery is
                          required for this signed-in step.
                        </p>
                      </>
                    ) : (
                      <>
                        <p>
                          {application.studentSetup
                            ? "The previous setup authorization expired. Renew it after confirming the family is ready."
                            : "The parent's enrollment is complete. Authorize the next step after confirming that this approved family is ready for student access."}
                        </p>
                        <label className="admissions-check">
                          <input
                            type="checkbox"
                            checked={confirmStudentSetup}
                            disabled={Boolean(busy)}
                            onChange={(event) =>
                              setConfirmStudentSetup(event.target.checked)
                            }
                          />
                          I confirm student setup is approved for this enrolled
                          parent and this application.
                        </label>
                        <button
                          type="button"
                          className="button button-primary"
                          disabled={Boolean(busy) || !confirmStudentSetup}
                          onClick={authorizeStudent}
                        >
                          {busy.includes("student-setup")
                            ? "Authorizing…"
                            : application.studentSetup
                              ? "Renew student setup"
                              : "Authorize student setup"}
                        </button>
                        <p className="admissions-caption">
                          Valid for seven days. The parent chooses credentials
                          and confirms the family connection; this action does
                          not create a student account.
                        </p>
                      </>
                    )}
                  </div>
                </section>
              )}
              <details className="admissions-audit">
                <summary>Decision history</summary>
                <ol>
                  {current.audit.map((entry) => (
                    <li key={entry.id}>
                      <span>{entry.action.replaceAll("_", " ")}</span>
                      <time dateTime={entry.createdAt}>
                        {interviewTime(entry.createdAt)}
                      </time>
                    </li>
                  ))}
                </ol>
              </details>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
