import {
  createUserWithEmailAndPassword,
  getIdTokenResult,
  getMultiFactorResolver,
  onIdTokenChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
  updateProfile as updateAuthProfile,
} from "firebase/auth";
import type {
  MultiFactorError,
  MultiFactorResolver,
  User,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getFirebaseClient } from "./firebaseClient";

export {
  FirebaseAuthServiceError,
  FirebaseMfaRequiredError,
  safeFirebaseAuthError,
  trustedRoleFromClaims,
  validateLocalSignupInput,
  validateDisplayName,
  validateSyntheticAccountEmail,
} from "./firebaseAuthTypes";
export type {
  FirebaseSession,
  FirebaseUserProfile,
  TrustedRole,
  FirebaseAuthErrorCode,
  FirebaseMfaChallenge,
} from "./firebaseAuthTypes";
import {
  FirebaseAuthServiceError,
  FirebaseMfaRequiredError,
  firebaseErrorCode,
  safeFirebaseAuthError,
  trustedRoleFromClaims,
  validateLocalSignupInput,
  validateDisplayName,
  validateSyntheticAccountEmail,
} from "./firebaseAuthTypes";
import type { FirebaseSession, FirebaseUserProfile } from "./firebaseAuthTypes";

const pendingMfa = new Map<
  string,
  { resolver: MultiFactorResolver; expiresAt: number }
>();
let mutationPending = false;
let signingOut = false;
let authIntentRevision = 0;
let mutationFinished: Promise<void> | undefined;

async function exclusive<T>(action: () => Promise<T>): Promise<T> {
  if (mutationPending || signingOut) throw new FirebaseAuthServiceError("BUSY");
  mutationPending = true;
  const revision = authIntentRevision;
  let finish = () => {};
  mutationFinished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  try {
    const result = await action();
    if (revision !== authIntentRevision)
      throw new FirebaseAuthServiceError("NOT_AUTHENTICATED");
    return result;
  } catch (error) {
    throw safeFirebaseAuthError(error);
  } finally {
    mutationPending = false;
    finish();
    mutationFinished = undefined;
  }
}

async function toSession(user: User): Promise<FirebaseSession> {
  validateSyntheticAccountEmail(user.email ?? "");
  const token = await getIdTokenResult(user);
  if (token.claims.aud !== getFirebaseClient().app.options.projectId)
    throw new FirebaseAuthServiceError(
      "CONFIGURATION",
      "The signed authentication token does not belong to the selected Firebase project. Ask the team to verify the test Web App configuration.",
    );
  const role = trustedRoleFromClaims(token.claims);
  return {
    mode: "firebase",
    environment: getFirebaseClient().mode,
    uid: user.uid,
    email: user.email ?? "",
    name: user.displayName ?? "",
    // reload() can update the SDK user before its cached token has refreshed.
    // Protected UI must wait for the same signed claim required by Rules.
    emailVerified: user.emailVerified && token.claims.email_verified === true,
    trustedRole: role,
    role,
  };
}

async function currentUser(): Promise<User> {
  const client = getFirebaseClient();
  await client.ready;
  await client.auth.authStateReady();
  if (!client.auth.currentUser)
    throw new FirebaseAuthServiceError("NOT_AUTHENTICATED");
  validateSyntheticAccountEmail(client.auth.currentUser.email ?? "");
  return client.auth.currentUser;
}

function requireIsolatedAuthWrites(): void {
  if (getFirebaseClient().mode === "firebase") {
    throw new FirebaseAuthServiceError("LIVE_PROVISIONING_UNCONFIRMED");
  }
}

function captureMfa(error: unknown): never {
  if (firebaseErrorCode(error) !== "auth/multi-factor-auth-required")
    throw error;
  const resolver = getMultiFactorResolver(
    getFirebaseClient().auth,
    error as MultiFactorError,
  );
  pendingMfa.clear();
  const id = crypto.randomUUID();
  pendingMfa.set(id, { resolver, expiresAt: Date.now() + 5 * 60_000 });
  throw new FirebaseMfaRequiredError({
    id,
    factors: resolver.hints.map((hint) => ({
      uid: hint.uid,
      label: hint.displayName?.slice(0, 80) || "Verification method",
      type:
        hint.factorId === TotpMultiFactorGenerator.FACTOR_ID
          ? "totp"
          : "unsupported",
    })),
  });
}

export const firebaseAuthService = {
  /** The SDK owns persistence and refresh; application storage never receives tokens. */
  subscribe(
    listener: (session: FirebaseSession | null) => void,
    onError?: (error: FirebaseAuthServiceError) => void,
  ): () => void {
    const client = getFirebaseClient();
    let active = true;
    let revision = 0;
    let unsubscribe: (() => void) | undefined;
    void client.ready
      .then(() => {
        if (!active) return;
        unsubscribe = onIdTokenChanged(
          client.auth,
          (user) => {
            if (!active) return;
            const next = ++revision;
            if (!user) {
              listener(null);
              return;
            }
            void toSession(user)
              .then((session) => {
                if (
                  active &&
                  !signingOut &&
                  revision === next &&
                  client.auth.currentUser?.uid === user.uid
                )
                  listener(session);
              })
              .catch((error: unknown) => {
                if (active && revision === next) {
                  listener(null);
                  onError?.(safeFirebaseAuthError(error));
                }
              });
          },
          (error) => {
            if (active) {
              listener(null);
              onError?.(safeFirebaseAuthError(error));
            }
          },
        );
      })
      .catch((error: unknown) => {
        if (active) {
          listener(null);
          onError?.(safeFirebaseAuthError(error));
        }
      });
    return () => {
      active = false;
      revision++;
      unsubscribe?.();
    };
  },

  signUp(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<FirebaseSession> {
    return exclusive(async () => {
      requireIsolatedAuthWrites();
      const { email, displayName: name } = validateLocalSignupInput(input);
      const client = getFirebaseClient();
      await client.ready;
      pendingMfa.clear();
      const credential = await createUserWithEmailAndPassword(
        client.auth,
        email,
        input.password,
      );
      try {
        await updateAuthProfile(credential.user, { displayName: name });
      } catch {
        throw new FirebaseAuthServiceError("PROFILE_INCOMPLETE");
      }
      // Server provisioning creates users/{uid} and grants any trusted role claim.
      // The UI must call provisionTalaStudent and refreshSession before continuing.
      return toSession(credential.user);
    });
  },

  signIn(email: string, password: string): Promise<FirebaseSession> {
    return exclusive(async () => {
      const client = getFirebaseClient();
      validateSyntheticAccountEmail(email);
      await client.ready;
      pendingMfa.clear();
      try {
        return await toSession(
          (
            await signInWithEmailAndPassword(
              client.auth,
              email.trim(),
              password,
            )
          ).user,
        );
      } catch (error) {
        return captureMfa(error);
      }
    });
  },

  signInWithGoogle(): Promise<FirebaseSession> {
    // Popup sign-in may provision a real Google identity before its email can
    // be inspected. This synthetic-only release cannot safely offer that path.
    return Promise.reject(new FirebaseAuthServiceError("PROVIDER_UNCONFIRMED"));
  },

  async signOut(): Promise<void> {
    pendingMfa.clear();
    signingOut = true;
    authIntentRevision++;
    const inFlight = mutationFinished;
    try {
      const client = getFirebaseClient();
      await client.ready;
      const auth = client.auth;
      await signOut(auth);
      // SDK sign-in cannot be aborted. Wait for it, then remove any session it
      // completed after the user's sign-out intent instead of reviving that login.
      await inFlight;
      if (auth.currentUser) await signOut(auth);
    } catch (error) {
      throw safeFirebaseAuthError(error);
    } finally {
      signingOut = false;
    }
  },

  async refreshSession(): Promise<FirebaseSession | null> {
    try {
      const user = await currentUser();
      await reload(user);
      await user.getIdToken(true);
      return await toSession(user);
    } catch (error) {
      if (
        error instanceof FirebaseAuthServiceError &&
        error.code === "NOT_AUTHENTICATED"
      )
        return null;
      throw safeFirebaseAuthError(error);
    }
  },

  async sendVerificationEmail(): Promise<void> {
    try {
      requireIsolatedAuthWrites();
      if (getFirebaseClient().mode === "firebase-test")
        throw new FirebaseAuthServiceError("TEST_EMAIL_DELIVERY_UNAVAILABLE");
      const user = await currentUser();
      validateSyntheticAccountEmail(user.email ?? "");
      if (!user.emailVerified) await sendEmailVerification(user);
    } catch (error) {
      throw safeFirebaseAuthError(error);
    }
  },

  async sendPasswordReset(email: string): Promise<void> {
    try {
      const client = getFirebaseClient();
      requireIsolatedAuthWrites();
      validateSyntheticAccountEmail(email);
      if (client.mode === "firebase-test")
        throw new FirebaseAuthServiceError("TEST_EMAIL_DELIVERY_UNAVAILABLE");
      await client.ready;
      await sendPasswordResetEmail(client.auth, email.trim());
    } catch (error) {
      throw safeFirebaseAuthError(error);
    }
  },

  async getProfile(): Promise<FirebaseUserProfile> {
    try {
      const user = await currentUser();
      const snapshot = await getDoc(
        doc(getFirebaseClient().db, "users", user.uid),
      );
      if (getFirebaseClient().auth.currentUser?.uid !== user.uid) {
        throw new FirebaseAuthServiceError("NOT_AUTHENTICATED");
      }
      const name: unknown = snapshot.data()?.displayName;
      return {
        uid: user.uid,
        exists: snapshot.exists(),
        displayName:
          typeof name === "string"
            ? name.slice(0, 80)
            : (user.displayName ?? ""),
      };
    } catch (error) {
      throw safeFirebaseAuthError(error);
    }
  },

  updateProfile(input: { displayName: string }): Promise<FirebaseUserProfile> {
    return exclusive(async () => {
      requireIsolatedAuthWrites();
      const name = validateDisplayName(input.displayName);
      const user = await currentUser();
      await setDoc(
        doc(getFirebaseClient().db, "users", user.uid),
        {
          displayName: name,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await updateAuthProfile(user, { displayName: name });
      return { uid: user.uid, displayName: name, exists: true };
    });
  },

  completeTotpSignIn(
    challengeId: string,
    factorUid: string,
    code: string,
  ): Promise<FirebaseSession> {
    return exclusive(async () => {
      const pending = pendingMfa.get(challengeId);
      if (!pending || pending.expiresAt <= Date.now()) {
        pendingMfa.delete(challengeId);
        throw new FirebaseAuthServiceError("EXPIRED_CHALLENGE");
      }
      if (!/^\d{6}$/.test(code))
        throw new FirebaseAuthServiceError("INVALID_CODE");
      const factor = pending.resolver.hints.find(
        (hint) => hint.uid === factorUid,
      );
      if (factor?.factorId !== TotpMultiFactorGenerator.FACTOR_ID) {
        throw new FirebaseAuthServiceError("UNSUPPORTED_FACTOR");
      }
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(
        factorUid,
        code,
      );
      const credential = await pending.resolver.resolveSignIn(assertion);
      pendingMfa.delete(challengeId);
      return toSession(credential.user);
    });
  },

  cancelMfaSignIn(): void {
    pendingMfa.clear();
  },
};
