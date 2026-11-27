import { getApps, initializeApp } from "firebase/app";
import { getAuth, signOut } from "firebase/auth";
import type { Auth } from "firebase/auth";
import {
  SKIPCLASS_PRODUCTION_PROJECT,
  validatePublicEnvironment,
} from "./firebaseConfiguration";

let pending: Promise<Auth> | undefined;
const pendingSignIns = new Set<Promise<unknown>>();
let logoutRequired = false;
let logoutInProgress: Promise<void> | undefined;

export function getLiveAuth(): Promise<Auth> {
  if (pending) return pending;
  pending = initialize().catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}

export function isLiveLogoutRequired(): boolean {
  return logoutRequired;
}

export function runLiveSignIn<T>(action: () => Promise<T>): Promise<T> {
  if (logoutRequired)
    return Promise.reject(new Error("Sign-in is unavailable during sign-out."));
  const operation = Promise.resolve().then(action);
  pendingSignIns.add(operation);
  void operation.then(
    () => pendingSignIns.delete(operation),
    () => pendingSignIns.delete(operation),
  );
  return operation;
}

export function signOutLiveAuth(): Promise<void> {
  if (logoutInProgress) return logoutInProgress;
  logoutRequired = true;
  const operation = (async () => {
    await Promise.allSettled([...pendingSignIns]);
    const auth = await getLiveAuth();
    await signOut(auth);
    if (auth.currentUser) await signOut(auth);
    logoutRequired = false;
  })();
  logoutInProgress = operation.finally(() => {
    logoutInProgress = undefined;
  });
  return logoutInProgress;
}

async function initialize(): Promise<Auth> {
  const env = import.meta.env;
  validatePublicEnvironment(env);
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  const apiKey = env.VITE_FIREBASE_API_KEY;
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN;
  const appId = env.VITE_FIREBASE_APP_ID;
  if (
    projectId !== SKIPCLASS_PRODUCTION_PROJECT ||
    !apiKey ||
    authDomain !== `${projectId}.firebaseapp.com` ||
    !appId ||
    !/^1:\d+:web:[a-f0-9]+$/.test(appId)
  )
    throw new Error(
      "Configure the production Firebase Web App before signing in.",
    );

  const url = new URL("https://identitytoolkit.googleapis.com/v1/projects");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("firebaseAppId", appId);
  try {
    const response = await fetch(url, {
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error();
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error();
    const metadata = result as Record<string, unknown>;
    if (
      metadata.projectId !== projectId ||
      !Array.isArray(metadata.authorizedDomains) ||
      !metadata.authorizedDomains.includes(authDomain)
    )
      throw new Error();
  } catch {
    throw new Error(
      "Firebase Auth configuration could not be verified. Check the Web App configuration and connection.",
    );
  }
  const options = { projectId, apiKey, authDomain, appId };
  const app =
    getApps().find((item) => item.name === "tala-live-access") ??
    initializeApp(options, "tala-live-access");
  if (
    Object.entries(options).some(
      ([key, value]) => app.options[key as keyof typeof options] !== value,
    )
  )
    throw new Error("Reload the page after changing Firebase configuration.");
  return getAuth(app);
}
