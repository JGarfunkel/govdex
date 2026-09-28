import type { ReactNode } from "react";
import { AuthProvider } from "../components/AuthProvider";
import "./globals.css";

export const metadata = {
  title: "GovDex — NY Civic Transparency",
  description: "Who represents each address in New York, and how reachable they are.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Read server-side (never bundled to the client) so a stray env var can't
  // leak the bypass into a prod build — it's also force-false in prod here,
  // belt-and-suspenders alongside the same check in apps/api/src/auth.ts.
  const localUnauthCanEdit = process.env.LOCAL_UNAUTH_CAN_EDIT === "true" && process.env.NODE_ENV !== "production";

  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css" />
      </head>
      <body>
        <AuthProvider localUnauthCanEdit={localUnauthCanEdit}>{children}</AuthProvider>
      </body>
    </html>
  );
}
