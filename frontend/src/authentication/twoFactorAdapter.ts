import { demoEnabled, demoToolsEnabled } from "../shared/services/demoConfig";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";

export interface TwoFactorSignup {
  parentName: string;
  parentEmail: string;
  studentName: string;
  studentEmail: string;
}

export type TwoFactorMethod = "authenticator" | "email";
export type TwoFactorErrorCode =
  "invalid_code" | "expired_code" | "challenge_ended" | "unavailable";

export class TwoFactorError extends Error {
  readonly code: TwoFactorErrorCode;

  constructor(code: TwoFactorErrorCode, message?: string) {
    super(message ?? code);
    this.name = "TwoFactorError";
    this.code = code;
  }
}

export interface TwoFactorChallenge {
  method: TwoFactorMethod;
  id: string;
  expiresAt?: number;
}

export interface AuthenticatorSetup extends TwoFactorChallenge {
  method: "authenticator";
  secret: string;
  qrDataUrl: string;
}

/** Keep adapter instances stable while mounted. Real adapters must validate on the server and never log codes or keys. */
export interface TwoFactorService {
  readonly environment?: "demo" | "live";
  readonly available?: boolean;
  readonly supportsFailureSimulation?: boolean;
  prepareAuthenticator(
    email: string,
    signal: AbortSignal,
  ): Promise<AuthenticatorSetup>;
  setup(
    method: TwoFactorMethod,
    signal: AbortSignal,
    simulateError?: boolean,
    prepared?: AuthenticatorSetup | null,
  ): Promise<TwoFactorChallenge>;
  verify(
    challenge: TwoFactorChallenge,
    code: string,
    signal: AbortSignal,
    simulateError?: boolean,
  ): Promise<void>;
  cancel(challenge: TwoFactorChallenge): void;
}

export const demoVerificationCode = "246810";

export interface MockTwoFactorOptions {
  enabled?: boolean;
  allowFailureSimulation?: boolean;
  delayMs?: number;
  now?: () => number;
  challengeTtlMs?: number;
}

interface MockChallenge {
  method: TwoFactorMethod;
  totp: TOTP | null;
  expiresAt: number;
}

let nextMockInstance = 0;

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Local mock: random keys, nothing sent or stored. */
export function createMockTwoFactorService({
  enabled = true,
  allowFailureSimulation = false,
  delayMs = 650,
  now = Date.now,
  challengeTtlMs = 10 * 60 * 1000,
}: MockTwoFactorOptions = {}): TwoFactorService {
  const activeChallenges = new Map<string, MockChallenge>();
  const instance = ++nextMockInstance;
  let nextChallenge = 0;

  function requireAvailable() {
    if (!enabled) throw new TwoFactorError("unavailable");
    for (const [id, challenge] of activeChallenges) {
      if (challenge.expiresAt <= now()) activeChallenges.delete(id);
    }
  }

  function getActive(challenge: TwoFactorChallenge): MockChallenge {
    const active = activeChallenges.get(challenge.id);
    if (
      !active ||
      active.method !== challenge.method ||
      active.expiresAt <= now()
    ) {
      activeChallenges.delete(challenge.id);
      throw new TwoFactorError("challenge_ended");
    }
    return active;
  }

  return {
    environment: "demo",
    available: enabled,
    supportsFailureSimulation: allowFailureSimulation,
    async prepareAuthenticator(email, signal) {
      signal.throwIfAborted();
      requireAvailable();
      const totp = new TOTP({
        issuer: "TALA Hub Demo",
        label: email,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: new Secret({ size: 20 }),
      });
      const qrDataUrl = await QRCode.toDataURL(totp.toString(), {
        errorCorrectionLevel: "M",
        margin: 4,
        width: 240,
      });
      signal.throwIfAborted();
      const id = `demo-challenge-${instance}-${++nextChallenge}`;
      const expiresAt = now() + challengeTtlMs;
      activeChallenges.set(id, {
        method: "authenticator",
        totp,
        expiresAt,
      });
      return {
        id,
        method: "authenticator",
        secret: totp.secret.base32,
        qrDataUrl,
        expiresAt,
      };
    },
    async setup(method, signal, simulateError, prepared) {
      signal.throwIfAborted();
      requireAvailable();
      await abortableDelay(delayMs, signal);
      signal.throwIfAborted();
      if (allowFailureSimulation && simulateError)
        throw new TwoFactorError(
          "unavailable",
          "Could not start the demo setup.",
        );
      if (method === "authenticator") {
        if (!prepared) throw new TwoFactorError("challenge_ended");
        getActive(prepared);
        return {
          id: prepared.id,
          method,
          expiresAt: prepared.expiresAt,
        };
      }
      const challenge = {
        method,
        id: `demo-challenge-${instance}-${++nextChallenge}`,
        expiresAt: now() + challengeTtlMs,
      };
      activeChallenges.set(challenge.id, {
        method,
        totp: null,
        expiresAt: challenge.expiresAt,
      });
      return challenge;
    },
    async verify(challenge, code, signal, simulateError) {
      signal.throwIfAborted();
      requireAvailable();
      await abortableDelay(delayMs, signal);
      signal.throwIfAborted();
      const active = getActive(challenge);
      if (allowFailureSimulation && simulateError)
        throw new TwoFactorError("unavailable");
      if (!/^\d{6}$/.test(code)) throw new TwoFactorError("invalid_code");
      const valid = active.totp
        ? active.totp.validate({ token: code, timestamp: now(), window: 1 }) !==
          null
        : code === demoVerificationCode;
      if (!valid) {
        // An expired and an unrecognized code look the same; the UI explains both.
        const older = active.totp?.validate({
          token: code,
          timestamp: now(),
          window: 10,
        });
        if (older !== null && older !== undefined && older < -1)
          throw new TwoFactorError("expired_code");
        throw new TwoFactorError("invalid_code");
      }
      activeChallenges.delete(challenge.id);
    },
    cancel(challenge) {
      activeChallenges.delete(challenge.id);
    },
  };
}

export const twoFactorService = createMockTwoFactorService({
  enabled: demoEnabled,
  allowFailureSimulation: demoToolsEnabled,
});
