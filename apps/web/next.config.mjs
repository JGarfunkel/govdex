import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// `next build apps/web` (invoked standalone from the repo-root `build`
// script) never goes through server/index.ts's own `import "dotenv/config"`,
// so NEXT_PUBLIC_* values wouldn't be inlined at build time without this.
// The programmatic `next({ dev, dir })` dev path (server/govdex.ts) already
// gets the root .env loaded first by server/index.ts, so this is a no-op
// duplicate there, not a conflict.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@govdex/shared"],
};

export default nextConfig;
