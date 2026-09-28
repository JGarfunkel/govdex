"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { getFirebaseAuth, isFirebaseConfigured } from "../lib/firebase-client";

interface AuthState {
  user: User | null;
  idToken: string | null;
  loading: boolean;
  // True once it's safe to show edit affordances: either a signed-in user,
  // or the LOCAL_UNAUTH_CAN_EDIT dev bypass (see RootLayout, which reads the
  // env var server-side and passes it down — it's already false in prod).
  canEdit: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  idToken: null,
  loading: true,
  canEdit: false,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({
  children,
  localUnauthCanEdit = false,
}: {
  children: ReactNode;
  localUnauthCanEdit?: boolean;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // No Firebase project configured yet: the rest of the site must stay
    // readable by guests, so behave as permanently signed-out rather than
    // throwing (see isFirebaseConfigured in lib/firebase-client).
    if (!isFirebaseConfigured()) {
      setLoading(false);
      return;
    }
    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setIdToken(nextUser ? await nextUser.getIdToken() : null);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        idToken,
        loading,
        canEdit: !loading && (localUnauthCanEdit || Boolean(user)),
        signOut: () => (isFirebaseConfigured() ? signOut(getFirebaseAuth()) : Promise.resolve()),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
