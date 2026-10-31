import { getApps, initializeApp } from "firebase/app";
import type { FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from "firebase/auth";
import type { Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import type { FirebaseStorage } from "firebase/storage";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import type { Functions } from "firebase/functions";

import {
  FirebaseConfigurationError,
  resolveBackendMode,
  resolveFirebaseConfiguration,
  prepareFirebaseInitialization,
} from "./firebaseConfiguration";
import type {
  FirebaseEnvironment,
  FirebaseNamespace,
} from "./firebaseConfiguration";
export {
  FirebaseConfigurationError,
  LOCAL_FIREBASE_PROJECT,
  resolveBackendMode,
  resolveFirebaseConfiguration,
  firebaseNamespace,
  SKIPCLASS_PRODUCTION_PROJECT,
  validatePublicEnvironment,
} from "./firebaseConfiguration";
export type {
  BackendMode,
  FirebaseEnvironment,
  FirebaseClientConfiguration,
  FirebaseNamespace,
} from "./firebaseConfiguration";

export interface FirebaseClient {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
  functions: Functions;
  mode: FirebaseEnvironment;
  namespace?: FirebaseNamespace;
  ready: Promise<void>;
}

export const backendMode = resolveBackendMode(
  import.meta.env?.VITE_BACKEND_MODE,
);
let client: FirebaseClient | undefined;

export function getFirebaseClient(): FirebaseClient {
  if (client) return client;
  const configuration = resolveFirebaseConfiguration(
    import.meta.env,
    window.location.hostname,
    window.location.protocol,
  );
  const initialization = prepareFirebaseInitialization(configuration, () => {
    const appName = `tala-backend-${configuration.mode}`;
    // No SDK app, Auth object or restored session exists before this callback.
    const app =
      getApps().find((entry) => entry.name === appName) ??
      initializeApp(configuration.options, appName);
    if (
      ["projectId", "authDomain", "storageBucket", "appId", "apiKey"].some(
        (key) =>
          app.options[key as keyof typeof app.options] !==
          configuration.options[key as keyof typeof configuration.options],
      )
    )
      throw new FirebaseConfigurationError(
        "Reload the page after changing Firebase environments.",
      );
    const auth = getAuth(app);
    const db = getFirestore(app);
    const storage = getStorage(app);
    const functions = getFunctions(app, configuration.functionsRegion);
    if (configuration.emulator) {
      const { host, authPort, firestorePort, storagePort, functionsPort } =
        configuration.emulator;
      const localApp = app as FirebaseApp & {
        talaEmulatorsConnected?: boolean;
      };
      if (!localApp.talaEmulatorsConnected) {
        connectAuthEmulator(auth, `http://${host}:${authPort}`);
        connectFirestoreEmulator(db, host, firestorePort);
        connectStorageEmulator(storage, host, storagePort);
        connectFunctionsEmulator(functions, host, functionsPort);
        localApp.talaEmulatorsConnected = true;
      }
    }
    return { app, auth, db, storage, functions };
  });
  const next: FirebaseClient = {
    get app() {
      return initialization.get().app;
    },
    get auth() {
      return initialization.get().auth;
    },
    get db() {
      return initialization.get().db;
    },
    get storage() {
      return initialization.get().storage;
    },
    get functions() {
      return initialization.get().functions;
    },
    mode: configuration.mode,
    namespace: configuration.namespace,
    ready: initialization.ready.then(() =>
      setPersistence(initialization.get().auth, browserLocalPersistence),
    ),
  };
  client = next;
  // A retry starts a new read-only preflight after a transient failure. Never
  // cache a failed promise indefinitely or fall back to another environment.
  void next.ready.catch(() => {
    if (client === next) client = undefined;
  });
  return client;
}
