import { expect, test } from "@playwright/test";
import { TOTP } from "otpauth";
import {
  createMockTwoFactorService,
  demoVerificationCode,
  TwoFactorError,
} from "../src/authentication/twoFactorAdapter";
import { normalizeVerificationCode } from "../src/authentication/twoFactorCode";
import {
  createMockPaymentAdapter,
  PaymentError,
  paymentDraftError,
  paymentErrorMessage,
  paymentIdentity,
} from "../src/payment/paymentAdapter";
import type {
  ApprovalStatus,
  FundingMethod,
  PaymentDraft,
  PaymentSession,
  SamplePaymentMethod,
} from "../src/payment/paymentAdapter";

const signal = () => new AbortController().signal;
const fixedTime = 1_700_000_000_000;

test.describe("SCRUM-46/47: isolated authentication adapter", () => {
  test("OTP normalization accepts pasted separators and full-width digits without discarding invalid text", () => {
    expect(normalizeVerificationCode(" ２４６-８１０ \n")).toBe(
      demoVerificationCode,
    );
    expect(normalizeVerificationCode("24a6810")).toBe("24a6810");
    expect(normalizeVerificationCode("2468107")).toBe("2468107");
    expect(normalizeVerificationCode("")).toBe("");
  });

  test("invalid codes and temporary errors can retry; verification is single-use", async () => {
    const service = createMockTwoFactorService({
      delayMs: 0,
      allowFailureSimulation: true,
    });
    const challenge = await service.setup("email", signal());
    await expect(
      service.verify(challenge, "12", signal()),
    ).rejects.toMatchObject({
      code: "invalid_code",
    });
    await expect(
      service.verify(challenge, demoVerificationCode, signal(), true),
    ).rejects.toMatchObject({ code: "unavailable" });
    await service.verify(challenge, demoVerificationCode, signal());
    await expect(
      service.verify(challenge, demoVerificationCode, signal()),
    ).rejects.toMatchObject({ code: "challenge_ended" });
  });

  test("authenticator accepts actual TOTP, recognizes expired tokens, and rejects replay", async () => {
    const service = createMockTwoFactorService({
      delayMs: 0,
      now: () => fixedTime,
    });
    const prepared = await service.prepareAuthenticator(
      "parent@example.com",
      signal(),
    );
    // Only Boolean assertions reference generated key material, so failure output is safe.
    expect(Boolean(prepared.secret)).toBe(true);
    expect(prepared.qrDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    const totp = new TOTP({ secret: prepared.secret, digits: 6, period: 30 });
    const challenge = await service.setup(
      "authenticator",
      signal(),
      false,
      prepared,
    );
    let expired = totp.generate({ timestamp: fixedTime - 180_000 });
    for (
      let age = 210_000;
      totp.validate({ token: expired, timestamp: fixedTime, window: 1 }) !==
      null;
      age += 30_000
    ) {
      expired = totp.generate({ timestamp: fixedTime - age });
    }
    await expect(
      service.verify(challenge, expired, signal()),
    ).rejects.toMatchObject({
      code: "expired_code",
    });
    const valid = totp.generate({ timestamp: fixedTime });
    await service.verify(challenge, valid, signal());
    await expect(
      service.verify(challenge, valid, signal()),
    ).rejects.toMatchObject({
      code: "challenge_ended",
    });
  });

  test("challenge expiration ends setup and verification, then a fresh setup succeeds", async () => {
    let now = fixedTime;
    const service = createMockTwoFactorService({
      delayMs: 0,
      now: () => now,
      challengeTtlMs: 1_000,
    });
    const prepared = await service.prepareAuthenticator(
      "parent@example.com",
      signal(),
    );
    const email = await service.setup("email", signal());
    now += 1_000;
    await expect(
      service.setup("authenticator", signal(), false, prepared),
    ).rejects.toMatchObject({ code: "challenge_ended" });
    await expect(
      service.verify(email, demoVerificationCode, signal()),
    ).rejects.toMatchObject({
      code: "challenge_ended",
    });
    const fresh = await service.setup("email", signal());
    await service.verify(fresh, demoVerificationCode, signal());
  });

  test("cancel prevents verification even when it interrupts a pending request", async () => {
    const service = createMockTwoFactorService({ delayMs: 10 });
    const challenge = await service.setup("email", signal());
    const verification = service.verify(
      challenge,
      demoVerificationCode,
      signal(),
    );
    service.cancel(challenge);
    await expect(verification).rejects.toMatchObject({
      code: "challenge_ended",
    });
    service.cancel(challenge);
  });

  test("abort preserves an existing challenge for retry but never completes verification", async () => {
    const service = createMockTwoFactorService({ delayMs: 10 });
    const challenge = await service.setup("email", signal());
    const controller = new AbortController();
    const verification = service.verify(
      challenge,
      demoVerificationCode,
      controller.signal,
    );
    controller.abort();
    await expect(verification).rejects.toMatchObject({ name: "AbortError" });
    await service.verify(challenge, demoVerificationCode, signal());
  });

  test("pre-aborted requests do not create a challenge or key; disabled service is typed", async () => {
    const service = createMockTwoFactorService({ delayMs: 0 });
    const controller = new AbortController();
    controller.abort();
    await expect(
      service.setup("email", controller.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(
      service
        .prepareAuthenticator("parent@example.com", controller.signal)
        .then(
          () => false,
          (error: unknown) =>
            error instanceof Error && error.name === "AbortError",
        ),
    ).resolves.toBe(true);
    const disabled = createMockTwoFactorService({ enabled: false, delayMs: 0 });
    expect(disabled.available).toBe(false);
    await expect(disabled.setup("email", signal())).rejects.toBeInstanceOf(
      TwoFactorError,
    );
    await expect(disabled.setup("email", signal())).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  test("failure simulation is opt-in and factory instances isolate their challenges", async () => {
    const isolated = createMockTwoFactorService({ delayMs: 0 });
    const service = createMockTwoFactorService({ delayMs: 0 });
    const challenge = await service.setup("email", signal(), true);
    await expect(
      isolated.verify(challenge, demoVerificationCode, signal()),
    ).rejects.toMatchObject({ code: "challenge_ended" });
    await service.verify(challenge, demoVerificationCode, signal(), true);
  });

  test("a foreign challenge cannot cancel or verify another factory's active challenge", async () => {
    const first = createMockTwoFactorService({ delayMs: 0 });
    const second = createMockTwoFactorService({ delayMs: 0 });
    const foreign = await first.setup("email", signal());
    const local = await second.setup("email", signal());
    expect(foreign.id === local.id).toBe(false);
    second.cancel(foreign);
    await expect(
      second.verify(foreign, demoVerificationCode, signal()),
    ).rejects.toMatchObject({ code: "challenge_ended" });
    await second.verify(local, demoVerificationCode, signal());
    await first.verify(foreign, demoVerificationCode, signal());
  });

  test("aborting QR preparation never yields a usable late key", async () => {
    const service = createMockTwoFactorService({ delayMs: 0 });
    const controller = new AbortController();
    const preparation = service.prepareAuthenticator(
      "parent@example.com",
      controller.signal,
    );
    controller.abort();
    await expect(
      preparation.then(
        () => false,
        (error: unknown) =>
          error instanceof Error && error.name === "AbortError",
      ),
    ).resolves.toBe(true);
  });
});

const account: PaymentSession = {
  mode: "demo",
  role: "Parent",
  email: "parent@example.com",
  name: "Sample Parent",
};
const validDraft: PaymentDraft = { funding: "ESA", acknowledged: true };

function deferredWait() {
  const completions: Array<() => void> = [];
  return {
    delay: () => new Promise<void>((resolve) => completions.push(resolve)),
    resolveNext() {
      const resolve = completions.shift();
      if (!resolve)
        throw new Error("No request is awaiting its controlled delay.");
      resolve();
    },
  };
}

test.describe("SCRUM-48/49: isolated approval and payment adapter", () => {
  test("every non-approved state gates submission, and approved state permits a demo receipt", async () => {
    const adapter = createMockPaymentAdapter({ delay: async () => {} });
    for (const status of ["pending", "not-approved", "rejected"] as const) {
      adapter.selectApprovalDemo?.(account, status);
      expect(await adapter.getApproval(account, signal())).toBe(status);
      await expect(
        adapter.submit(account, validDraft, signal()),
      ).rejects.toMatchObject({
        code: "APPROVAL_REQUIRED",
      });
      expect(adapter.getSnapshot(account).receipt).toBeNull();
    }
    adapter.selectApprovalDemo?.(account, "approved");
    expect(await adapter.getApproval(account, signal())).toBe("approved");
    expect(await adapter.submit(account, validDraft, signal())).toEqual({
      mode: "demo",
      funding: "ESA",
    });
  });

  test("draft validation rejects missing/unknown funding and missing acknowledgment before submission", async () => {
    const adapter = createMockPaymentAdapter({ delay: async () => {} });
    adapter.selectApprovalDemo?.(account, "approved");
    const missingFunding: PaymentDraft = { funding: "", acknowledged: false };
    const invalidFunding = {
      funding: "unsupported" as FundingMethod,
      acknowledged: true,
    };
    const missingAcknowledgment: PaymentDraft = {
      funding: "STO",
      acknowledged: false,
    };
    for (const draft of [missingFunding, invalidFunding]) {
      expect(paymentDraftError(draft)).toContain("Choose a funding method");
      await expect(
        adapter.submit(account, draft, signal()),
      ).rejects.toMatchObject({
        code: "FUNDING_REQUIRED",
      });
    }
    expect(paymentDraftError(missingAcknowledgment)).toContain("Confirm");
    await expect(
      adapter.submit(account, missingAcknowledgment, signal()),
    ).rejects.toMatchObject({ code: "ACKNOWLEDGMENT_REQUIRED" });
    expect(paymentDraftError(validDraft)).toBe("");
    expect(adapter.getSnapshot(account).status).toBe("idle");
  });

  test("double submission is rejected while in flight; completed submission is idempotent", async () => {
    const wait = deferredWait();
    const adapter = createMockPaymentAdapter({ delay: wait.delay });
    adapter.selectApprovalDemo?.(account, "approved");
    const first = adapter.submit(account, validDraft, signal());
    expect(adapter.getSnapshot(account).status).toBe("submitting");
    await expect(
      adapter.submit(account, validDraft, signal()),
    ).rejects.toMatchObject({
      code: "BUSY",
    });
    wait.resolveNext();
    const receipt = await first;
    const repeat = await adapter.submit(
      account,
      { funding: "STO", acknowledged: true },
      signal(),
    );
    expect(repeat).toEqual(receipt);
    expect(adapter.getSnapshot(account).receipt?.funding).toBe("ESA");
    repeat.funding = "Private";
    expect(adapter.getSnapshot(account).receipt?.funding).toBe("ESA");
  });

  test("submission captures its funding choice before a caller mutates the draft", async () => {
    const wait = deferredWait();
    const adapter = createMockPaymentAdapter({ delay: wait.delay });
    adapter.selectApprovalDemo?.(account, "approved");
    const draft: PaymentDraft = { funding: "STO", acknowledged: true };
    const result = adapter.submit(account, draft, signal());
    draft.funding = "Private";
    draft.acknowledged = false;
    wait.resolveNext();
    expect((await result).funding).toBe("STO");
  });

  test("explicit cancellation rejects a non-cooperative late response and requires restart", async () => {
    const wait = deferredWait();
    const adapter = createMockPaymentAdapter({ delay: wait.delay });
    adapter.selectApprovalDemo?.(account, "approved");
    const submitted = adapter.submit(account, validDraft, signal());
    const rejected = expect(submitted).rejects.toMatchObject({
      code: "CANCELLED",
    });
    adapter.cancel(account);
    expect(adapter.getSnapshot(account).status).toBe("cancelled");
    wait.resolveNext();
    await rejected;
    expect(adapter.getSnapshot(account).receipt).toBeNull();
    await expect(
      adapter.submit(account, validDraft, signal()),
    ).rejects.toMatchObject({
      code: "CANCELLED",
    });
    adapter.restart(account);
    const retried = adapter.submit(account, validDraft, signal());
    wait.resolveNext();
    expect((await retried).mode).toBe("demo");
  });

  test("old cancelled request cannot change a newer restarted attempt", async () => {
    const wait = deferredWait();
    const adapter = createMockPaymentAdapter({ delay: wait.delay });
    adapter.selectApprovalDemo?.(account, "approved");
    const first = adapter.submit(account, validDraft, signal());
    const firstRejected = expect(first).rejects.toMatchObject({
      code: "CANCELLED",
    });
    adapter.cancel(account);
    adapter.restart(account);
    const second = adapter.submit(
      account,
      { funding: "Private", acknowledged: true, demoMethod: "card" },
      signal(),
    );
    wait.resolveNext();
    await firstRejected;
    expect(adapter.getSnapshot(account).status).toBe("submitting");
    wait.resolveNext();
    expect((await second).funding).toBe("Private");
    expect(adapter.getSnapshot(account).status).toBe("success");
  });

  test("revoked approval invalidates a saved receipt and never resurrects it after reapproval", async () => {
    const adapter = createMockPaymentAdapter({ delay: async () => {} });
    adapter.selectApprovalDemo?.(account, "approved");
    await adapter.submit(account, validDraft, signal());
    const previousRevision = adapter.getSnapshot(account).approvalRevision;
    adapter.selectApprovalDemo?.(account, "pending");
    expect(adapter.getSnapshot(account).receipt).toBeNull();
    expect(adapter.getSnapshot(account).approvalRevision).toBeGreaterThan(
      previousRevision,
    );
    adapter.selectApprovalDemo?.(account, "approved");
    expect(adapter.getSnapshot(account).receipt).toBeNull();
    const next = await adapter.submit(
      account,
      { funding: "STO", acknowledged: true },
      signal(),
    );
    expect(next.funding).toBe("STO");
  });

  test("approval change rejects an old non-cooperative submission after approval returns", async () => {
    const wait = deferredWait();
    const adapter = createMockPaymentAdapter({ delay: wait.delay });
    adapter.selectApprovalDemo?.(account, "approved");
    const submitted = adapter.submit(account, validDraft, signal());
    const rejected = expect(submitted).rejects.toMatchObject({
      code: "APPROVAL_CHANGED",
    });
    adapter.selectApprovalDemo?.(account, "pending");
    adapter.selectApprovalDemo?.(account, "approved");
    wait.resolveNext();
    await rejected;
    expect(adapter.getSnapshot(account).receipt).toBeNull();
    expect(adapter.getSnapshot(account).status).toBe("idle");
  });

  test("reset generation rejects ABA stale payment and approval responses for the same identity", async () => {
    const wait = deferredWait();
    const adapter = createMockPaymentAdapter({ delay: wait.delay });
    adapter.selectApprovalDemo?.(account, "approved");
    const originalGeneration = adapter.getSnapshot(account).generation;
    const submitted = adapter.submit(account, validDraft, signal());
    const paymentRejected = expect(submitted).rejects.toMatchObject({
      code: "STALE_SESSION",
    });
    const approval = adapter.getApproval(account, signal());
    const approvalRejected = expect(approval).rejects.toMatchObject({
      code: "STALE_SESSION",
    });
    adapter.resetDemo?.();
    adapter.selectApprovalDemo?.(account, "approved");
    expect(adapter.getSnapshot(account).generation).toBeGreaterThan(
      originalGeneration,
    );
    wait.resolveNext();
    wait.resolveNext();
    await paymentRejected;
    await approvalRejected;
    expect(adapter.getSnapshot(account).receipt).toBeNull();
    expect(adapter.getSnapshot(account).status).toBe("idle");
  });

  test("snapshots are stable and immutable; subscribers receive only their identity changes", async () => {
    const adapter = createMockPaymentAdapter({ delay: async () => {} });
    const other = { ...account, email: "other@example.com" };
    let accountUpdates = 0;
    let otherUpdates = 0;
    const unsubscribe = adapter.subscribe(account, () => {
      accountUpdates += 1;
    });
    const unsubscribeOther = adapter.subscribe(other, () => {
      otherUpdates += 1;
    });
    const initial = adapter.getSnapshot(account);
    expect(adapter.getSnapshot({ ...account })).toBe(initial);
    expect(Object.isFrozen(initial)).toBe(true);
    adapter.selectApprovalDemo?.(account, "approved");
    expect(accountUpdates).toBe(1);
    expect(otherUpdates).toBe(0);
    const approved = adapter.getSnapshot(account);
    adapter.selectApprovalDemo?.(account, "approved");
    expect(adapter.getSnapshot(account)).toBe(approved);
    expect(accountUpdates).toBe(1);
    await adapter.submit(account, validDraft, signal());
    const success = adapter.getSnapshot(account);
    expect(Object.isFrozen(success)).toBe(true);
    expect(Object.isFrozen(success.receipt)).toBe(true);
    const beforeUnsubscribe = accountUpdates;
    unsubscribe();
    unsubscribeOther();
    adapter.resetDemo?.();
    expect(accountUpdates).toBe(beforeUnsubscribe);
    expect(otherUpdates).toBe(0);
    expect(adapter.getSnapshot(account).approval).toBe("pending");
  });

  test("role, account ID, and mode form separate identities and do not share authorization", async () => {
    const adapter = createMockPaymentAdapter({ delay: async () => {} });
    adapter.selectApprovalDemo?.(account, "approved");
    for (const other of [
      { ...account, role: "Student" as const },
      { ...account, email: "other@example.com" },
      { ...account, accountId: "separate-account" },
    ]) {
      expect(paymentIdentity(other)).not.toBe(paymentIdentity(account));
      expect(adapter.getSnapshot(other).approval).toBe("pending");
      await expect(
        adapter.submit(other, validDraft, signal()),
      ).rejects.toMatchObject({
        code: "APPROVAL_REQUIRED",
      });
    }
    const live = { ...account, mode: "live" as const };
    expect(paymentIdentity(live)).not.toBe(paymentIdentity(account));
    await expect(adapter.getApproval(live, signal())).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });

  test("typed service failures preserve retry and error mapper suppresses unknown provider details", async () => {
    const adapter = createMockPaymentAdapter({
      delay: async () => {},
      toolsEnabled: true,
    });
    adapter.selectApprovalDemo?.(account, "approved");
    await expect(
      adapter.getApproval(account, signal(), true),
    ).rejects.toMatchObject({
      code: "APPROVAL_UNAVAILABLE",
    });
    expect(await adapter.getApproval(account, signal())).toBe("approved");
    await expect(
      adapter.submit(account, validDraft, signal(), true),
    ).rejects.toMatchObject({
      code: "PAYMENT_FAILED",
    });
    expect(adapter.getSnapshot(account)).toMatchObject({
      status: "error",
      errorCode: "PAYMENT_FAILED",
      receipt: null,
    });
    await adapter.submit(account, validDraft, signal());
    expect(adapter.getSnapshot(account).status).toBe("success");
    expect(paymentErrorMessage(new PaymentError("PAYMENT_FAILED"))).toContain(
      "No payment was made",
    );
    const unknown = "PRIVATE_PROVIDER_DETAILS_MUST_NOT_RENDER";
    expect(paymentErrorMessage(new Error(unknown))).not.toContain(unknown);
    expect(
      paymentErrorMessage({ code: "PAYMENT_FAILED", message: unknown }),
    ).not.toContain(unknown);
  });

  test("live adapter copy never claims an uncertain provider failure or cancellation made no charge", () => {
    for (const code of ["PAYMENT_FAILED", "CANCELLED"] as const) {
      const message = paymentErrorMessage(new PaymentError(code), "live");
      expect(message).toContain("status");
      expect(message).not.toMatch(/demo|No payment was made/i);
    }
    expect(
      paymentDraftError({ funding: "", acknowledged: false }, "live"),
    ).toBe("Choose a funding method.");
    expect(
      paymentDraftError({ funding: "ESA", acknowledged: false }, "live"),
    ).not.toContain("demo");
    expect(
      paymentDraftError({ funding: "Private", acknowledged: true }, "live"),
    ).toBe("");
  });

  test("private demo payment requires a fixed sample method before acknowledgment", async () => {
    const adapter = createMockPaymentAdapter({ delay: async () => {} });
    adapter.selectApprovalDemo?.(account, "approved");
    const message = "Choose a demo payment method before continuing.";
    for (const method of [undefined, "unsupported" as SamplePaymentMethod]) {
      const draft: PaymentDraft = {
        funding: "Private",
        acknowledged: false,
        demoMethod: method,
      };
      expect(paymentDraftError(draft)).toBe(message);
      await expect(
        adapter.submit(account, draft, signal()),
      ).rejects.toMatchObject({
        code: "DEMO_METHOD_REQUIRED",
      });
    }
    expect(adapter.getSnapshot(account).status).toBe("idle");
    expect(
      paymentDraftError({
        funding: "Private",
        acknowledged: false,
        demoMethod: "card",
      }),
    ).toContain("Confirm");
    expect(
      paymentDraftError({
        funding: "Private",
        acknowledged: true,
        demoMethod: "bank",
      }),
    ).toBe("");
  });

  test("private submission captures its fixed method and returns an isolated immutable receipt", async () => {
    const wait = deferredWait();
    const adapter = createMockPaymentAdapter({ delay: wait.delay });
    adapter.selectApprovalDemo?.(account, "approved");
    const draft: PaymentDraft = {
      funding: "Private",
      acknowledged: true,
      demoMethod: "card",
    };
    const result = adapter.submit(account, draft, signal());
    draft.demoMethod = "bank";
    draft.funding = "STO";
    draft.acknowledged = false;
    wait.resolveNext();
    const receipt = await result;
    expect(receipt).toEqual({
      mode: "demo",
      funding: "Private",
      demoMethod: "card",
    });
    const repeated = await adapter.submit(
      account,
      { funding: "Private", acknowledged: true, demoMethod: "bank" },
      signal(),
    );
    expect(repeated).toEqual(receipt);
    if (repeated.mode === "demo") repeated.demoMethod = "bank";
    expect(adapter.getSnapshot(account).receipt).toEqual({
      mode: "demo",
      funding: "Private",
      demoMethod: "card",
    });
    expect(Object.isFrozen(adapter.getSnapshot(account).receipt)).toBe(true);
  });

  test("card and bank demo failures retry without recording a premature receipt", async () => {
    for (const method of ["card", "bank"] as const) {
      const adapter = createMockPaymentAdapter({
        delay: async () => {},
        toolsEnabled: true,
      });
      adapter.selectApprovalDemo?.(account, "approved");
      const draft: PaymentDraft = {
        funding: "Private",
        acknowledged: true,
        demoMethod: method,
      };
      await expect(
        adapter.submit(account, draft, signal(), true),
      ).rejects.toMatchObject({
        code: "PAYMENT_FAILED",
      });
      expect(adapter.getSnapshot(account)).toMatchObject({
        status: "error",
        receipt: null,
      });
      expect(await adapter.submit(account, draft, signal())).toEqual({
        mode: "demo",
        funding: "Private",
        demoMethod: method,
      });
      expect(adapter.getSnapshot(account).status).toBe("success");
    }
  });

  test("funding demos ignore method extras and never persist unsolicited credential properties", async () => {
    for (const funding of ["ESA", "STO", "Private"] as const) {
      const adapter = createMockPaymentAdapter({ delay: async () => {} });
      adapter.selectApprovalDemo?.(account, "approved");
      // Structural caller input can contain extra fields; only allowlisted view data survives.
      const draft = {
        funding,
        acknowledged: true,
        demoMethod: (funding === "Private"
          ? "card"
          : "unsupported") as SamplePaymentMethod,
        cardNumber: "NOT_A_REAL_CARD",
        securityCode: "NOT_COLLECTED",
        billingAddress: "NOT_COLLECTED",
        credentials: { source: "test-only marker" },
      };
      const expected = {
        mode: "demo",
        funding,
        ...(funding === "Private" ? { demoMethod: "card" } : {}),
      };
      expect(await adapter.submit(account, draft, signal())).toEqual(expected);
      expect(adapter.getSnapshot(account).receipt).toEqual(expected);
    }
  });

  test("external abort never records a result and restart permits a fresh submission", async () => {
    const adapter = createMockPaymentAdapter({ paymentDelayMs: 10 });
    adapter.selectApprovalDemo?.(account, "approved");
    const controller = new AbortController();
    const submitted = adapter.submit(account, validDraft, controller.signal);
    controller.abort();
    await expect(submitted).rejects.toMatchObject({ name: "AbortError" });
    expect(adapter.getSnapshot(account).status).toBe("cancelled");
    expect(adapter.getSnapshot(account).receipt).toBeNull();
    adapter.restart(account);
    await adapter.submit(account, validDraft, signal());
    expect(adapter.getSnapshot(account).status).toBe("success");
  });

  test("pre-aborted payment and approval requests preserve an approved idle snapshot", async () => {
    const adapter = createMockPaymentAdapter({ delay: async () => {} });
    adapter.selectApprovalDemo?.(account, "approved");
    const before = adapter.getSnapshot(account);
    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter.submit(account, validDraft, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      adapter.getApproval(account, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(adapter.getSnapshot(account)).toBe(before);
  });

  test("disabled services and invalid fixture states fail safely, and tools can be disabled", async () => {
    const disabled = createMockPaymentAdapter({
      enabled: false,
      delay: async () => {},
    });
    await expect(disabled.getApproval(account, signal())).rejects.toMatchObject(
      { code: "UNAVAILABLE" },
    );
    await expect(
      disabled.submit(account, validDraft, signal()),
    ).rejects.toBeInstanceOf(PaymentError);
    const adapter = createMockPaymentAdapter({
      delay: async () => {},
      toolsEnabled: false,
    });
    expect(() =>
      adapter.selectApprovalDemo?.(account, "unknown" as ApprovalStatus),
    ).toThrow(PaymentError);
    adapter.selectApprovalDemo?.(account, "approved");
    expect(await adapter.getApproval(account, signal(), true)).toBe("approved");
    await adapter.submit(account, validDraft, signal(), true);
    expect(adapter.getSnapshot(account).status).toBe("success");
  });
});
