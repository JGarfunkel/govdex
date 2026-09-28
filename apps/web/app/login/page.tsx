"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
} from "firebase/auth";
import { getFirebaseAuth } from "../../lib/firebase-client";
import { useAuth } from "../../components/AuthProvider";

export default function LoginPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
      router.push("/scribe");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    try {
      await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
      router.push("/scribe");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    }
  }

  if (user) {
    return (
      <main>
        <p>Signed in as {user.email}. <a href="/scribe">Go to the scribe console &rarr;</a></p>
      </main>
    );
  }

  return (
    <main>
      <h1>Scribe sign-in</h1>
      <form onSubmit={handleEmailSignIn}>
        <label>Email<br /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <br />
        <label>Password<br /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <br />
        <button type="submit" style={{ marginTop: 12 }}>Sign in</button>
      </form>
      <p><button onClick={handleGoogleSignIn}>Sign in with Google</button></p>
      {error && <p className="warning">{error}</p>}
      <p style={{ marginTop: 24, fontSize: "0.9em" }} className="field-blank">
        Sign-in requires a configured Firebase project (NEXT_PUBLIC_FIREBASE_* in .env).
      </p>
    </main>
  );
}
