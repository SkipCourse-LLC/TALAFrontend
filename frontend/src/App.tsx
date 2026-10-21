import { lazy, Suspense, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { SiteLayout } from "./shared/SiteLayout";
import { RouteFocus } from "./shared/RouteFocus";
import { CommunityPage } from "./public-site/CommunityPage";
import { HomePage } from "./public-site/HomePage";
import { AboutPage } from "./public-site/AboutPage";
import { ProgramsPage } from "./public-site/ProgramsPage";
import { RegisterPage } from "./registration/RegisterPage";
import { ApprovalPage } from "./payment/ApprovalPage";
import { PaymentPage } from "./payment/PaymentPage";
import { resetPaymentDemo } from "./payment/paymentService";
import { TwoFactorPage } from "./authentication/TwoFactorPage";
import type { EnrollmentReceipt } from "./registration/enrollmentService";
import { LoginPage } from "./authentication/LoginPage";
const StudentDashboard = lazy(() =>
  import("./dashboard/StudentDashboard").then((module) => ({
    default: module.StudentDashboard,
  })),
);
import { NotFoundPage } from "./public-site/NotFoundPage";
import { readDemoSession, saveDemoSession } from "./authentication/authService";
import type { DemoSession } from "./shared/services/serviceTypes";
const FirebaseApplication = lazy(() =>
  import("./backend/FirebaseApplication").then((module) => ({
    default: module.FirebaseApplication,
  })),
);

export default function App() {
  const mode = import.meta.env.VITE_BACKEND_MODE;
  if (!mode || mode === "demo") return <DemoApplication />;
  if (
    mode !== "firebase" &&
    mode !== "firebase-emulator" &&
    mode !== "firebase-test"
  )
    return (
      <section className="container state-panel" role="alert">
        <h1>Backend configuration unavailable</h1>
        <p>Use demo, firebase-emulator or an approved firebase environment.</p>
      </section>
    );
  return (
    <Suspense
      fallback={
        <div className="container state-panel" role="status">
          Connecting to authentication…
        </div>
      }
    >
      <FirebaseApplication />
    </Suspense>
  );
}

function DemoApplication() {
  const [session, setSession] = useState(readDemoSession);
  const navigate = useNavigate();
  const [signup, setSignup] = useState<EnrollmentReceipt | null>(null);
  const needsVerification = !!signup && !session;
  function beginVerification(receipt: EnrollmentReceipt) {
    resetPaymentDemo();
    saveDemoSession(null);
    setSession(null);
    setSignup(receipt);
    navigate("/two-factor", { replace: true });
  }
  function verified() {
    if (!signup) return;
    const next: DemoSession = {
      mode: "demo",
      role: "Parent",
      name: signup.parentName,
      email: signup.parentEmail,
      studentName: signup.studentName,
      studentEmail: signup.studentEmail,
    };
    resetPaymentDemo();
    saveDemoSession(next);
    setSession(next);
  }
  function login(next: DemoSession) {
    setSignup(null);
    resetPaymentDemo();
    saveDemoSession(next);
    setSession(next);
  }
  function logout() {
    resetPaymentDemo();
    setSignup(null);
    saveDemoSession(null);
    setSession(null);
    navigate("/login", { replace: true });
  }
  return (
    <>
      <Routes>
        <Route element={<SiteLayout session={session} />}>
          <Route index element={<HomePage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="learn-more" element={<AboutPage />} />
          <Route path="events" element={<CommunityPage kind="events" />} />
          <Route path="contact" element={<CommunityPage kind="contact" />} />
          <Route path="programs" element={<ProgramsPage />} />
          <Route
            path="register"
            element={<RegisterPage onComplete={beginVerification} />}
          />
          <Route
            path="two-factor"
            element={
              <TwoFactorPage
                receipt={signup}
                verified={!!session}
                onVerified={verified}
                onCancel={logout}
              />
            }
          />
          <Route
            path="login"
            element={
              needsVerification ? (
                <Navigate to="/two-factor" replace />
              ) : (
                <LoginPage onLogin={login} />
              )
            }
          />
          <Route
            path="dashboard"
            element={
              needsVerification ? (
                <Navigate to="/two-factor" replace />
              ) : session ? (
                <Suspense
                  fallback={
                    <div className="container state-panel" role="status">
                      Opening your student hub…
                    </div>
                  }
                >
                  <StudentDashboard
                    session={session}
                    enrollment={signup ?? undefined}
                    onLogout={logout}
                  />
                </Suspense>
              ) : (
                <Navigate to="/login" state={{ fromDashboard: true }} replace />
              )
            }
          />
          <Route
            path="enrollment-status"
            element={
              needsVerification ? (
                <Navigate to="/two-factor" replace />
              ) : session ? (
                <ApprovalPage
                  key={`${session.role}-${session.email}`}
                  session={session}
                />
              ) : (
                <Navigate to="/login" state={{ fromPayment: true }} replace />
              )
            }
          />
          <Route
            path="payment"
            element={
              needsVerification ? (
                <Navigate to="/two-factor" replace />
              ) : session ? (
                <PaymentPage
                  key={`${session.role}-${session.email}`}
                  session={session}
                />
              ) : (
                <Navigate to="/login" state={{ fromPayment: true }} replace />
              )
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <RouteFocus />
    </>
  );
}
