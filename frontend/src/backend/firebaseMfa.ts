import { multiFactor, TotpMultiFactorGenerator } from "firebase/auth";
import type { TotpSecret } from "firebase/auth";
import { getFirebaseClient } from "./firebaseClient";
import {
  FirebaseAuthServiceError,
  safeFirebaseAuthError,
} from "./firebaseAuth";

export interface FirebaseTotpEnrollment {
  challengeId: string;
  manualKey: string;
  qrUri: string;
}

// Only the active enrollment holds a key, in memory. No local/session storage,
// Firestore document, analytics event, or log ever receives this secret.
let enrollment:
  | { id: string; uid: string; secret: TotpSecret; expiresAt: number }
  | undefined;
let generation = 0;
let busy = false;

export function firebaseTotpAvailable(): boolean {
  // Firebase Auth Emulator does not implement TOTP MFA. Never simulate server
  // verification or present local OTP computation as a real second factor.
  return (
    import.meta.env.VITE_BACKEND_MODE === "firebase-test" &&
    import.meta.env.VITE_FIREBASE_TEST_APPROVED === "true" &&
    import.meta.env.VITE_FIREBASE_TOTP_APPROVED === "true"
  );
}

export function cancelFirebaseTotpEnrollment(): void {
  generation++;
  enrollment = undefined;
}

export async function beginFirebaseTotpEnrollment(): Promise<FirebaseTotpEnrollment> {
  if (!firebaseTotpAvailable()) {
    throw new FirebaseAuthServiceError("MFA_UNAVAILABLE");
  }
  if (busy) throw new FirebaseAuthServiceError("BUSY");
  busy = true;
  const revision = ++generation;
  enrollment = undefined;
  try {
    const client = getFirebaseClient();
    await client.ready;
    await client.auth.authStateReady();
    const user = client.auth.currentUser;
    if (!user) throw new FirebaseAuthServiceError("NOT_AUTHENTICATED");
    if (!user.emailVerified)
      throw new FirebaseAuthServiceError("EMAIL_NOT_VERIFIED");
    const session = await multiFactor(user).getSession();
    const secret = await TotpMultiFactorGenerator.generateSecret(session);
    if (revision !== generation || client.auth.currentUser?.uid !== user.uid) {
      throw new FirebaseAuthServiceError("EXPIRED_CHALLENGE");
    }
    const id = crypto.randomUUID();
    enrollment = {
      id,
      uid: user.uid,
      secret,
      expiresAt: Date.now() + 5 * 60_000,
    };
    return {
      challengeId: id,
      manualKey: secret.secretKey,
      qrUri: secret.generateQrCodeUrl(user.email ?? undefined, "TALA"),
    };
  } catch (error) {
    throw safeFirebaseAuthError(error);
  } finally {
    busy = false;
  }
}

export async function completeFirebaseTotpEnrollment(
  challengeId: string,
  code: string,
): Promise<void> {
  if (!firebaseTotpAvailable())
    throw new FirebaseAuthServiceError("UNSUPPORTED_FACTOR");
  if (busy) throw new FirebaseAuthServiceError("BUSY");
  const current = enrollment;
  if (
    !current ||
    current.id !== challengeId ||
    current.expiresAt <= Date.now()
  ) {
    cancelFirebaseTotpEnrollment();
    throw new FirebaseAuthServiceError("EXPIRED_CHALLENGE");
  }
  if (!/^\d{6}$/.test(code)) throw new FirebaseAuthServiceError("INVALID_CODE");
  const user = getFirebaseClient().auth.currentUser;
  if (!user || user.uid !== current.uid || !user.emailVerified) {
    cancelFirebaseTotpEnrollment();
    throw new FirebaseAuthServiceError("NOT_AUTHENTICATED");
  }
  busy = true;
  const revision = generation;
  try {
    const assertion = TotpMultiFactorGenerator.assertionForEnrollment(
      current.secret,
      code,
    );
    await multiFactor(user).enroll(assertion, "Authenticator app");
    if (
      revision !== generation ||
      getFirebaseClient().auth.currentUser?.uid !== user.uid
    ) {
      throw new FirebaseAuthServiceError("EXPIRED_CHALLENGE");
    }
    cancelFirebaseTotpEnrollment();
    await user.getIdToken(true);
  } catch (error) {
    throw safeFirebaseAuthError(error);
  } finally {
    busy = false;
  }
}
