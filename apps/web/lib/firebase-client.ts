import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

// Firebase Web SDK, config from NEXT_PUBLIC_* env vars (see .env — these are
// intentionally blank until a real Firebase project is created; sign-in will
// fail with a clear Firebase error until then, not silently).
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Guests can read the whole site without signing in (see AuthProvider), so a
// missing project must never throw — only code paths that actually need
// sign-in (calling getFirebaseAuth) should ever see a Firebase error.
export function isFirebaseConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId,
  );
}

let app: FirebaseApp | undefined;
let auth: Auth | undefined;

export function getFirebaseAuth(): Auth {
  if (!isFirebaseConfigured()) {
    throw new Error(
      "Firebase Web SDK is not configured (NEXT_PUBLIC_FIREBASE_* env vars are blank). " +
        "Set them from your Firebase project's web app settings before signing in.",
    );
  }
  if (!app) {
    app = getApps()[0] ?? initializeApp(firebaseConfig);
  }
  if (!auth) {
    auth = getAuth(app);
  }
  return auth;
}
