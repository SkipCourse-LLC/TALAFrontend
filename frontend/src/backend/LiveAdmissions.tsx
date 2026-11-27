import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { User } from "firebase/auth";
import { firebaseAuthService } from "./firebaseAuth";
import { admissionsRequest } from "./admissionsApi";

type Account = { email: string; role: "parent" | "student"; uid: string };

function addresses(value: string) {
  return value
    .split(/\n/)
    .map((email) => email.trim())
    .filter(Boolean);
}

export function LiveAdmissions({ user }: { user: User }) {
  const [parents, setParents] = useState("");
  const [students, setStudents] = useState("");
  const [consentDates, setConsentDates] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const parentEmails = addresses(parents);
    const studentEmails = addresses(students);
    const emails = [...parentEmails, ...studentEmails];
    if (
      !parentEmails.length ||
      !studentEmails.length ||
      emails.length > 20 ||
      emails.some(
        (email) => email.length > 254 || !/^[^@\s]+@[^@\s]+$/.test(email),
      ) ||
      new Set(emails.map((email) => email.toLowerCase())).size !== emails.length
    ) {
      setError(
        "Enter 1–20 distinct, valid email addresses, with at least one parent and one student.",
      );
      return;
    }
    if (!consent || !overwrite) {
      setError(
        "Confirm enrollment, consent, and the account changes before proceeding.",
      );
      return;
    }
    const dates = parentEmails.map(
      (email) => new Date(consentDates[email.toLowerCase()] ?? ""),
    );
    if (
      dates.some(
        (date) =>
          !Number.isFinite(date.getTime()) || date.getTime() > Date.now(),
      )
    ) {
      setError(
        "Enter when consent was obtained for each parent; future dates are not accepted.",
      );
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setStatus("Creating or updating accounts and linking the family…");
    try {
      const accounts: Account[] = [];
      for (const [role, list] of [
        ["parent", parentEmails],
        ["student", studentEmails],
      ] as const) {
        for (const email of list) {
          const value = await admissionsRequest(
            user,
            "/accounts",
            controller.signal,
            { email, role },
          );
          if (
            !value ||
            typeof value !== "object" ||
            !("uid" in value) ||
            typeof value.uid !== "string" ||
            !value.uid
          ) {
            throw new Error(
              "The account service returned an invalid response.",
            );
          }
          accounts.push({ email, role, uid: value.uid });
        }
      }
      for (const parent of accounts.filter((item) => item.role === "parent"))
        for (const student of accounts.filter(
          (item) => item.role === "student",
        )) {
          const result = await admissionsRequest(
            user,
            "/relationships",
            controller.signal,
            {
              student_uid: student.uid,
              parent_uid: parent.uid,
              consent_attested: true,
              consent_given_at: new Date(
                consentDates[parent.email.toLowerCase()]!,
              ).toISOString(),
            },
          );
          if (
            !result ||
            typeof result !== "object" ||
            !("status" in result) ||
            result.status !== "active"
          )
            throw new Error(
              "The relationship service did not confirm an active link.",
            );
        }
      const failed: string[] = [];
      for (const account of accounts) {
        controller.signal.throwIfAborted();
        try {
          await firebaseAuthService.sendPasswordReset(account.email);
        } catch {
          // eslint-disable-next-line no-console
          console.error("[TALA admissions] Password reset request failed.");
          failed.push(account.email);
        }
      }
      if (controller.signal.aborted) return;
      if (failed.length) {
        setError(
          `Password reset requests failed for: ${failed.join(", ")}. Account and relationship changes may already be saved; retry when ready.`,
        );
        setStatus("");
      } else {
        setStatus(
          "Accounts and links saved. Firebase accepted the password-reset requests; delivery is not guaranteed. Recipients must verify their email before accessing a dashboard.",
        );
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setStatus("");
        setError(
          `${failure instanceof Error ? failure.message : "The request failed."} Some changes may already be saved. Check the accounts and retry.`,
        );
      }
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section className="live-admissions">
      <h3>Set up family accounts</h3>
      <p>
        Every parent listed will be linked to every student listed. Use only a
        single family per submission.
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          <label className="form-field">
            Parent email addresses, one per line
            <textarea
              required
              value={parents}
              onChange={(event) => {
                setParents(event.target.value);
                setConsent(false);
                setOverwrite(false);
              }}
              rows={3}
            />
          </label>
          <label className="form-field">
            Student email addresses, one per line
            <textarea
              required
              value={students}
              onChange={(event) => {
                setStudents(event.target.value);
                setConsent(false);
                setOverwrite(false);
              }}
              rows={3}
            />
          </label>
          {Array.from(
            new Set(addresses(parents).map((email) => email.toLowerCase())),
          ).map((email) => (
            <label className="form-field" key={email}>
              Date and time consent was obtained from {email}
              <input
                type="datetime-local"
                required
                value={consentDates[email] ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setConsentDates((current) => ({
                    ...current,
                    [email]: value,
                  }));
                  setConsent(false);
                }}
              />
            </label>
          ))}
          <label className="live-admissions-confirm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              required
            />{" "}
            I attest that the listed family is enrolled and parental consent for
            linking and viewing student records has already been obtained.
          </label>
          <label className="live-admissions-confirm">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(event) => setOverwrite(event.target.checked)}
              required
            />{" "}
            I understand existing accounts, including those from other schools,
            will have their school and role changed; password-reset emails will
            be requested.
          </label>
          <button className="button" type="submit">
            {busy ? "Setting up…" : "Set up family accounts"}
          </button>
        </fieldset>
      </form>
      <p>
        Password reset is for email/password accounts. Existing Google-only
        accounts may need to continue using Google; Firebase does not guarantee
        email delivery. Existing credentials and custom claims are not removed.
        A reset link is single-use, not a one-time password.
      </p>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
