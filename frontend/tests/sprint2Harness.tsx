import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MemoryRouter } from "react-router-dom";
import { TwoFactorPage } from "../src/authentication/TwoFactorPage";
import { createMockTwoFactorService } from "../src/authentication/twoFactorAdapter";
import type { TwoFactorService } from "../src/authentication/twoFactorAdapter";
import { PaymentPage } from "../src/payment/PaymentPage";
import { ApprovalPage } from "../src/payment/ApprovalPage";
import { createMockPaymentAdapter } from "../src/payment/paymentAdapter";
import type {
  ApprovalStatus,
  PaymentService,
} from "../src/payment/paymentAdapter";

// Test-only host: no App, shared code, signup/login pages or product routes.
const query = new URLSearchParams(location.search);
const scenario = query.get("scenario") ?? "normal";
const flow = query.get("flow") ?? "two-factor";
const diagnostic = "Private diagnostic fixture; do not display";
let release: (() => void) | undefined;
let verifyCalls = 0;
let submitCalls = 0;
let switchIdentity: (() => void) | undefined;
let rerender: (() => void) | undefined;

const twoFactorMock = createMockTwoFactorService({
  delayMs: scenario === "slow" ? 300 : 0,
  allowFailureSimulation: true,
  challengeTtlMs: scenario === "expired" ? 1200 : undefined,
});
const twoFactorService: TwoFactorService = {
  ...twoFactorMock,
  async prepareAuthenticator(email, signal) {
    if (scenario === "unknown-prepare") throw new Error(diagnostic);
    if (scenario === "late-prepare") {
      const setup = await twoFactorMock.prepareAuthenticator(
        email,
        new AbortController().signal,
      );
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return setup;
    }
    return twoFactorMock.prepareAuthenticator(email, signal);
  },
  async verify(...args) {
    verifyCalls++;
    if (scenario === "unknown-verify") throw new Error(diagnostic);
    if (scenario === "late-verify") {
      // Deliberately ignores AbortSignal: consumers must reject late success.
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return;
    }
    return twoFactorMock.verify(...args);
  },
};
const paymentMock = createMockPaymentAdapter({
  toolsEnabled: true,
  approvalDelayMs: 0,
  paymentDelayMs: scenario === "slow" ? 500 : 0,
});
const paymentService: PaymentService = {
  ...paymentMock,
  async submit(...args) {
    submitCalls++;
    if (scenario === "unknown-payment") throw new Error(diagnostic);
    if (scenario === "late-payment") {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        mode: "demo",
        funding: args[1].funding as "ESA" | "STO" | "Private",
      };
    }
    return paymentMock.submit(...args);
  },
};

export interface Sprint2Fixture {
  release(): void;
  pending(): boolean;
  switchIdentity(): void;
  rerender(): void;
  replaceService(): void;
  selectApproval(status: ApprovalStatus): void;
  counts(): { verify: number; submit: number };
}
declare global {
  interface Window {
    sprint2Fixture: Sprint2Fixture;
  }
}

function Fixture() {
  const [identity, setIdentity] = useState(0);
  const [verified, setVerified] = useState(false);
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const [, setVersion] = useState(0);
  const [serviceVersion, setServiceVersion] = useState(0);
  const session = useMemo(
    () => ({
      mode: "demo" as const,
      role: "Parent" as const,
      name: identity ? "Second Parent" : "Demo Parent",
      email: identity ? "second@example.com" : "first@example.com",
    }),
    [identity],
  );
  const receipt = {
    parentName: session.name,
    parentEmail: session.email,
    studentName: "Demo Learner",
    studentEmail: identity
      ? "second-learner@example.com"
      : "first-learner@example.com",
  };
  useEffect(() => {
    if (flow === "payment")
      paymentMock.selectApprovalDemo?.(session, "approved");
    switchIdentity = () => flushSync(() => setIdentity((value) => value + 1));
    rerender = () => setVersion((value) => value + 1);
    window.sprint2Fixture = {
      release: () => {
        const callback = release;
        release = undefined;
        callback?.();
      },
      pending: () => !!release,
      switchIdentity: () => switchIdentity?.(),
      rerender: () => rerender?.(),
      replaceService: () =>
        flushSync(() => setServiceVersion((value) => value + 1)),
      selectApproval: (status) =>
        paymentMock.selectApprovalDemo?.(session, status),
      counts: () => ({ verify: verifyCalls, submit: submitCalls }),
    };
    return () => {
      switchIdentity = undefined;
      rerender = undefined;
    };
  }, [session]);
  return (
    <MemoryRouter>
      {flow === "payment" ? (
        <PaymentPage
          session={session}
          service={serviceVersion ? paymentMock : paymentService}
        />
      ) : flow === "approval" ? (
        <ApprovalPage session={session} service={paymentService} />
      ) : cancelled ? (
        <h1>Signup fixture cancelled</h1>
      ) : (
        <TwoFactorPage
          receipt={scenario === "empty" ? null : receipt}
          verified={verified}
          service={serviceVersion ? twoFactorMock : twoFactorService}
          onVerified={() => {
            setVerified(true);
            setVerifiedCount((value) => value + 1);
          }}
          onCancel={() => setCancelled(true)}
        />
      )}
      {flow === "two-factor" && (
        <p
          data-testid="verified-count"
          aria-label="Fixture verification callback count"
        >
          {verifiedCount}
        </p>
      )}
    </MemoryRouter>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
