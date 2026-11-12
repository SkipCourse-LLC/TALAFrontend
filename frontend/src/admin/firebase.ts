import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Firebase web config is public by design; access is enforced by security rules.
const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

const configured = Object.values(firebaseConfig).every(Boolean);
const app = configured
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

export const firebaseConfigured = Boolean(app);
export const auth = app ? getAuth(app) : null;
export const storage = app ? getStorage(app) : null;

function createFirestore() {
  if (!app) return null;
  try {
    return initializeFirestore(app, { ignoreUndefinedProperties: true });
  } catch {
    return getFirestore(app);
  }
}

export const db = createFirestore();
