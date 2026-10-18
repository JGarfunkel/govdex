// Expire GovDex's cached pages after an ingestion/spider run (or any direct DB
// change). Ingestion writes bypass withUser, so nothing else tells the server.
//
//   REVALIDATE_URL=https://govdex.example REVALIDATE_SECRET=... npx tsx ingestion/tools/revalidate.ts [tag ...]
//
// With no REVALIDATE_URL it targets localhost:$PORT (a local instance).
import "dotenv/config";
import { requestRevalidate } from "../../apps/api/src/lib/revalidate";

if (!process.env.REVALIDATE_SECRET) {
  console.error("REVALIDATE_SECRET is not set");
  process.exit(1);
}
const tags = process.argv.slice(2);
await requestRevalidate(tags.length ? tags : undefined);
console.log(`revalidate requested at ${process.env.REVALIDATE_URL ?? "localhost"}`);
