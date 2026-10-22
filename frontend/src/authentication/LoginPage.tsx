import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthForm } from "./AuthForm";
import { Icon } from "../shared/Icon";
import { authErrorMessage, authService } from "./authService";
import type { AuthValues } from "./formValidation";
import { demoEnabled } from "../shared/services/demoConfig";
import { sampleSession } from "../shared/services/demoData";
import type { EnrollmentReceipt } from "../registration/enrollmentContract";
import type {
  CommunityRole,
  DemoSession,
} from "../shared/services/serviceTypes";
export function LoginPage({
  onLogin,
}: {
  onLogin: (session: DemoSession) => void;
}) {
  const location = useLocation();
  return <LoginPageContent key={location.key} onLogin={onLogin} />;
}

function LoginPageContent({
  onLogin,
}: {
  onLogin: (session: DemoSession) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [pendingSource, setPendingSource] = useState<"form" | "sample" | null>(
    null,
  );
  const [quickError, setQuickError] = useState("");
  const request = useRef<AbortController | null>(null);
  const quickErrorBox = useRef<HTMLParagraphElement>(null);
  const state = location.state as {
    registered?: { name: string; email: string };
    fromDashboard?: boolean;
    fromPayment?: boolean;
    family?: EnrollmentReceipt;
    role?: CommunityRole;
  } | null;
  const registered = state?.registered;
  const [role, setRole] = useState<CommunityRole>(state?.role ?? "Student");
  const [parentView, setParentView] = useState("self");
  const family = state?.family;
  const studentName = family?.studentName ?? sampleSession.name;
  const pending = pendingSource !== null;
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );
  useEffect(() => {
    if (quickError) quickErrorBox.current?.focus();
  }, [quickError]);

  async function openSession(
    values: AuthValues,
    simulateError: boolean,
    source: "form" | "sample",
  ) {
    if (request.current || !demoEnabled) return;
    const controller = new AbortController();
    request.current = controller;
    setPendingSource(source);
    setQuickError("");
    // Capture these before awaiting so later UI changes can't alter the result.
    const chosenRole = role;
    const chosenParentView = parentView;
    const destination = state?.fromPayment
      ? "/enrollment-status"
      : "/dashboard";
    try {
      const session = await authService.login(
        values.email,
        values.password,
        registered?.name ??
          (source === "sample" ? sampleSession.name : undefined),
        simulateError,
        controller.signal,
      );
      if (controller.signal.aborted || request.current !== controller) return;
      onLogin({
        ...session,
        role: chosenRole,
        name:
          chosenRole === "Parent"
            ? (family?.parentName ?? "Demo parent")
            : chosenRole === "Student"
              ? session.name
              : `Demo ${chosenRole.toLowerCase()}`,
        studentName: chosenRole === "Parent" ? studentName : undefined,
        studentEmail:
          chosenRole === "Parent"
            ? (family?.studentEmail ?? sampleSession.email)
            : undefined,
        representing:
          chosenRole === "Parent" && chosenParentView === "student"
            ? studentName
            : undefined,
      });
      navigate(destination, { replace: true });
    } catch (error) {
      if (!controller.signal.aborted && request.current === controller)
        throw error;
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setPendingSource(null);
      }
    }
  }
  return (
    <section className="auth-layout container">
      <div className="auth-panel">
        <h1>Welcome back.</h1>
        <p>
          New to TALA? <Link to="/register">Create a demo profile</Link>
        </p>
        {state?.fromPayment && (
          <p className="notice" role="status">
            Sign in to check approval before opening the payment demo.
          </p>
        )}
        {state?.fromDashboard && (
          <div className="notice" role="status">
            Open a demo session to explore the student dashboard.
          </div>
        )}
        <div className="form-field">
          <label htmlFor="community-role">I am a</label>
          <select
            id="community-role"
            value={role}
            aria-describedby="auth-role-hint"
            disabled={pending}
            onChange={(event) => {
              if (request.current) return;
              setRole(event.target.value as CommunityRole);
              setQuickError("");
            }}
          >
            {(["Student", "Parent", "Alumni", "Staff"] as const).map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
        {role === "Parent" && (
          <fieldset className="identity-choice" disabled={pending}>
            <legend>Enter the community</legend>
            <label className="checkbox-row">
              <input
                type="radio"
                name="parent-view"
                checked={parentView === "self"}
                onChange={() => {
                  if (!request.current) setParentView("self");
                }}
              />
              As myself (parent)
            </label>
            <label className="checkbox-row">
              <input
                type="radio"
                name="parent-view"
                checked={parentView === "student"}
                onChange={() => {
                  if (!request.current) setParentView("student");
                }}
              />
              On behalf of {studentName} (sample student)
            </label>
          </fieldset>
        )}
        <p className="sr-only" id="auth-role-hint">
          Choose the workspace you want to preview.
        </p>
        <AuthForm
          key={role}
          initialEmail={
            role === "Parent" ? family?.parentEmail : registered?.email
          }
          pending={pending}
          onSubmit={(values, simulateError) =>
            openSession(values, simulateError, "form")
          }
        />
        <div className="or-divider">
          <span>Just taking a look?</span>
        </div>
        <button
          className="button button-outline button-full"
          type="button"
          disabled={pending || !demoEnabled}
          onClick={async () => {
            try {
              await openSession(
                {
                  email:
                    role === "Parent"
                      ? (family?.parentEmail ?? "parent@example.com")
                      : (registered?.email ?? sampleSession.email),
                  password: "",
                },
                false,
                "sample",
              );
            } catch (error) {
              setQuickError(authErrorMessage(error));
            }
          }}
        >
          {pendingSource === "sample"
            ? "Opening demo…"
            : "Explore with a sample profile"}
          <Icon name="arrow" />
        </button>
        {quickError && (
          <p
            ref={quickErrorBox}
            tabIndex={-1}
            className="field-error"
            role="alert"
          >
            {quickError}
          </p>
        )}
        <p className="small">
          Your sample profile stays in this tab until sign-out. Class choices
          may remain for this tab. Passwords are never saved.
        </p>
      </div>
      <aside className="auth-story">
        <p className="eyebrow">A connected learning space</p>
        <h2>
          Your learning.
          <br />
          One place.
        </h2>
        <p>Keep your learning paths, next classes and family updates close.</p>
        <div className="auth-preview-list">
          <div>
            <Icon name="book" />
            <span>
              <strong>Learning paths</strong>
              <small>A clear view of your progress</small>
            </span>
          </div>
          <div>
            <Icon name="grid" />
            <span>
              <strong>Weekly calendar</strong>
              <small>Your next class, in one place</small>
            </span>
          </div>
          <div>
            <Icon name="user" />
            <span>
              <strong>Family access</strong>
              <small>Explore your learner’s workspace</small>
            </span>
          </div>
        </div>
        <p className="auth-story-note">
          A preview of your future learning space.
        </p>
      </aside>
    </section>
  );
}
