import type { NextFunction, Request, Response } from "express";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getPool } from "./db";

export interface AuthedUser {
  id: string;
  firebase_uid: string;
  email: string;
  display_name: string | null;
  global_role: string;
  official_id: string | null;
}

declare module "express-serve-static-core" {
  interface Request {
    govdexUser?: AuthedUser;
  }
}

// Lazily initialized so importing this module doesn't blow up when Firebase
// admin credentials aren't configured yet (e.g. local dev before the user has
// created a Firebase project) — the failure only happens when a request
// actually needs auth, with a clear message, not at process boot.
function getFirebaseAuth() {
  if (getApps().length === 0) {
    const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        "Firebase Admin credentials are not configured (FIREBASE_ADMIN_PROJECT_ID / " +
          "FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY). Set these in .env " +
          "from your Firebase project's service account before using authenticated routes.",
      );
    }
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  return getAuth();
}

// First login provisions a row at the lowest privilege. Elevation to
// scribe/editor/admin is a separate admin action, never inferred from the token.
async function resolveUser(uid: string, email: string | undefined): Promise<AuthedUser> {
  const { rows } = await getPool().query(
    `insert into users (firebase_uid, email, global_role)
       values ($1, $2, 'viewer')
     on conflict (firebase_uid) do update set email = excluded.email
     returning id, firebase_uid, email, display_name, global_role, official_id`,
    [uid, email ?? null],
  );
  return rows[0];
}

// Dev-only bypass: set AUTH=none to skip Firebase entirely and act as a
// fixed local admin user. Never enable this in production.
const AUTH_DISABLED = process.env.AUTH === "none";
if (AUTH_DISABLED && process.env.NODE_ENV === "production") {
  throw new Error("AUTH=none must not be set when NODE_ENV=production");
}

// Dev-only bypass for the EntityPage edit UI: set LOCAL_UNAUTH_CAN_EDIT=true
// to let every request edit as the local admin user, no sign-in required.
// Unlike AUTH=none this one is quietly ignored (not a boot-time throw) once
// NODE_ENV=production, since it's meant to be left on in a shared .env and
// only matters for the apps/web client bypass in RootLayout.
const LOCAL_UNAUTH_CAN_EDIT = process.env.LOCAL_UNAUTH_CAN_EDIT === "true" && process.env.NODE_ENV !== "production";

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (AUTH_DISABLED || LOCAL_UNAUTH_CAN_EDIT) {
    try {
      req.govdexUser = await resolveLocalDevUser();
      next();
    } catch (err) {
      res.status(500).json({ message: err instanceof Error ? err.message : "Failed to resolve local dev user" });
    }
    return;
  }

  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (!token) {
    res.status(401).json({ message: "Missing bearer token" });
    return;
  }
  try {
    const decoded = await getFirebaseAuth().verifyIdToken(token);
    req.govdexUser = await resolveUser(decoded.uid, decoded.email);
    next();
  } catch (err) {
    res.status(401).json({ message: err instanceof Error ? err.message : "Invalid token" });
  }
}

async function resolveLocalDevUser(): Promise<AuthedUser> {
  const { rows } = await getPool().query(
    `insert into users (firebase_uid, email, global_role)
       values ('local-dev', 'dev@localhost', 'admin')
     on conflict (firebase_uid) do update set global_role = 'admin'
     returning id, firebase_uid, email, display_name, global_role, official_id`,
  );
  return rows[0];
}
