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
import { resetPaymentDemo } from "./payment/paymentAdapter";
import { LoginPage } from "./authentication/LoginPage";
import { NotFoundPage } from "./public-site/NotFoundPage";
import { readDemoSession, saveDemoSession } from "./authentication/authService";
import type { DemoSession } from "./shared/services/serviceTypes";

const StudentDashboard = lazy(() =>
  import("./dashboard/StudentDashboard").then((module) => ({
    default: module.StudentDashboard,
  })),
);

export function DemoApplication() {
  const [session, setSession] = useState(readDemoSession);
  const navigate = useNavigate();

  function login(next: DemoSession) {
    resetPaymentDemo();
    saveDemoSession(next);
    setSession(next);
  }

  function logout() {
    resetPaymentDemo();
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
          
          {/* Render the new self-contained RegisterPage */}
          <Route path="register" element={<RegisterPage />} />
          
          {/* Skip the fake 2FA and go straight to login */}
          <Route
            path="login"
            element={<LoginPage onLogin={login} />}
          />
          
          <Route
            path="dashboard"
            element={
              session ? (
                <Suspense
                  fallback={
                    <div className="container state-panel" role="status">
                      Opening your student hub…
                    </div>
                  }
                >
                  <StudentDashboard
                    session={session}
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
              session ? (
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
              session ? (
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