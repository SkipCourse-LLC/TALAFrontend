import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { SiteLayout } from "../shared/SiteLayout";
import { RouteFocus } from "../shared/RouteFocus";
import { HomePage } from "../public-site/HomePage";
import { AboutPage } from "../public-site/AboutPage";
import { ProgramsPage } from "../public-site/ProgramsPage";
import { CommunityPage } from "../public-site/CommunityPage";
import { NotFoundPage } from "../public-site/NotFoundPage";
import { PaymentPage } from "../payment/PaymentPage";
import { ApprovalPage } from "../payment/ApprovalPage";
import { PaymentError } from "../payment/paymentAdapter";
import type {
  PaymentService,
  PaymentSnapshot,
} from "../payment/paymentAdapter";
import { backendMode } from "./firebaseClient";
import { firebaseAuthService, safeFirebaseAuthError } from "./firebaseAuth";
import type { FirebaseSession } from "./firebaseAuth";
import { FirebaseAccessPage } from "./FirebaseAccessPage";
import { FirebaseWorkspace } from "./FirebaseWorkspace";
import { FirebaseSecurityPage } from "./FirebaseSecurityPage";
import {
  provisionStudent,
  TalaDataError,
  safeTalaDataError,
} from "./talaDataService";
import "./FirebaseWorkspace.css";

// No production eligibility/provider contract has been approved. Reuse the
// existing payment UI without granting eligibility from a local meeting or MFA.
const paymentSnapshot: PaymentSnapshot = Object.freeze({
  approval: "pending",
  approvalRevision: 0,
  generation: 0,
  status: "idle",
  receipt: null,
  errorCode: null,
});
const unavailablePayment: PaymentService = {
  environment: "live",
  getSnapshot: () => paymentSnapshot,
  subscribe: () => () => {},
  getApproval: async () => {
    throw new PaymentError("UNAVAILABLE");
  },
  submit: async () => {
    throw new PaymentError("UNAVAILABLE");
  },
  cancel: () => {},
  restart: () => {},
};

export function FirebaseApplication() {
  const [session, setSession] = useState<FirebaseSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = firebaseAuthService.subscribe(
        (next) => {
          if (active) {
            setSession(next);
            setLoading(false);
            setError("");
          }
        },
        (failure) => {
          if (active) {
            setSession(null);
            setLoading(false);
            setError(failure.message);
          }
        },
      );
    } catch (failure) {
      // A configuration failure must never fall back to the permissive demo.
      queueMicrotask(() => {
        if (active) {
          setLoading(false);
          setError(safeFirebaseAuthError(failure).message);
        }
      });
    }
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [attempt]);

  async function logout() {
    await firebaseAuthService.signOut();
    setSession(null);
    navigate("/login", { replace: true });
  }
  async function refreshSession() {
    setSession(await firebaseAuthService.refreshSession());
  }
  function protect(children: ReactNode) {
    if (loading)
      return (
        <div className="container state-panel" role="status">
          Restoring your authenticated session…
        </div>
      );
    return session ? children : <Navigate to="/login" replace />;
  }
  if (error)
    return (
      <section className="container state-panel" role="alert">
        <h1>Firebase connection unavailable</h1>
        <p>{error}</p>
        <button
          className="button button-outline"
          type="button"
          onClick={() => {
            setError("");
            setLoading(true);
            setAttempt((n) => n + 1);
          }}
        >
          Retry connection
        </button>
      </section>
    );
  const paymentSession = session
    ? {
        mode: "live" as const,
        accountId: session.uid,
        name: session.name,
        email: session.email,
      }
    : null;
  return (
    <>
      <Routes>
        <Route
          element={
            <SiteLayout
              session={session}
              backend={
                backendMode === "firebase-emulator"
                  ? "firebase-emulator"
                  : backendMode === "firebase-test"
                    ? "firebase-test"
                    : "firebase"
              }
            />
          }
        >
          <Route index element={<HomePage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="learn-more" element={<AboutPage />} />
          <Route path="programs" element={<ProgramsPage />} />
          <Route path="events" element={<CommunityPage kind="events" />} />
          <Route path="contact" element={<CommunityPage kind="contact" />} />
          <Route path="login" element={<FirebaseAccessPage key="login" />} />
          <Route
            path="register"
            element={<FirebaseAccessPage key="register" register />}
          />
          <Route
            path="dashboard"
            element={protect(
              session && (
                <>
                  <FirebaseAccountVerification
                    key={session.uid}
                    session={session}
                    onRefresh={refreshSession}
                    onLogout={logout}
                  />
                  <FirebaseWorkspace
                    key={session.uid}
                    session={session}
                    onLogout={logout}
                    onProfileUpdated={refreshSession}
                  />
                </>
              ),
            )}
          />
          <Route
            path="two-factor"
            element={protect(
              session && (
                <FirebaseSecurityPage
                  key={session.uid}
                  session={session}
                  onRefresh={refreshSession}
                />
              ),
            )}
          />
          <Route
            path="enrollment-status"
            element={protect(
              paymentSession && (
                <>
                  <p className="container firebase-account-check" role="status">
                    Payment eligibility and a payment provider are not
                    connected. No application approval or charge is confirmed
                    here.
                  </p>
                  <ApprovalPage
                    session={paymentSession}
                    service={unavailablePayment}
                  />
                </>
              ),
            )}
          />
          <Route
            path="payment"
            element={protect(
              paymentSession && (
                <>
                  <p className="container firebase-account-check" role="status">
                    Payment eligibility and a payment provider are not
                    connected. No application approval or charge is confirmed
                    here.
                  </p>
                  <PaymentPage
                    session={paymentSession}
                    service={unavailablePayment}
                  />
                </>
              ),
            )}
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <RouteFocus />
    </>
  );
}

function FirebaseAccountVerification({
  session,
  onRefresh,
  onLogout,
}: {
  session: FirebaseSession;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const active = useRef(false);
  const busy = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function run(action: () => Promise<string>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const message = await action();
      if (active.current) setNotice(message);
    } catch (failure) {
      if (active.current)
        setError(
          failure instanceof TalaDataError
            ? safeTalaDataError(failure).message
            : safeFirebaseAuthError(failure).message,
        );
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }
  const local = session.environment === "firebase-emulator";
  return (
    <section
      className="container firebase-account-check"
      aria-labelledby="firebase-identity-title"
      aria-busy={pending}
    >
      <h2 id="firebase-identity-title">Account verification</h2>
      <p>
        {session.emailVerified
          ? "Email address verified by Firebase."
          : "Verify your email before booking or submitting evidence. This is email ownership verification, not school admission or payment approval."}
      </p>
      {!session.emailVerified && (
        <>
          {local ? (
            <button
              className="button button-outline"
              type="button"
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  await firebaseAuthService.sendVerificationEmail();
                  return local
                    ? "Verification requested. Open the action link shown in the Auth Emulator terminal, then return here."
                    : "Verification email requested. Check your inbox, then return here.";
                })
              }
            >
              Send verification email
            </button>
          ) : (
            <p>
              Test accounts use synthetic email addresses. An authorized test
              operator must verify the account in the approved test project;
              this app cannot mark it verified.
            </p>
          )}
          {local && (
            <p>
              The Emulator does not send email. Use the verification link in the
              local backend terminal.{" "}
              <a
                href="http://127.0.0.1:4000/auth"
                target="_blank"
                rel="noreferrer"
              >
                Open local Auth Emulator
              </a>
              .
            </p>
          )}
          <button
            className="button button-primary"
            type="button"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                await onRefresh();
                return "Account status refreshed from Firebase.";
              })
            }
          >
            {local
              ? "I have verified my email"
              : "Refresh account verification"}
          </button>
        </>
      )}
      {!session.trustedRole && (
        <>
          <p>
            Your account has no recognized server-issued role. Protected
            learning services remain locked.
          </p>
          {(local || session.environment === "firebase-test") && (
            <button
              className="button button-outline"
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  await provisionStudent(session.name || "Test learner");
                  await onRefresh();
                  return "Student profile saved and server-issued role refreshed.";
                })
              }
            >
              {local
                ? "Complete local profile setup"
                : "Retry approved test profile setup"}
            </button>
          )}
        </>
      )}
      <p>
        <Link to="/two-factor">Account security and authenticator setup</Link>
      </p>
      <button
        className="button button-outline"
        type="button"
        disabled={pending}
        onClick={() =>
          void run(async () => {
            await onLogout();
            return "Signed out.";
          })
        }
      >
        Sign out of Firebase
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
