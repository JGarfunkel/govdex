import { z } from "zod";
import { REVISION_OPS } from "../enums";

// Tables a scribe may propose edits against. Deliberately a fixed allowlist,
// not "any table" — keeps propose/accept from becoming a generic SQL door.
export const PROPOSABLE_TABLES = [
  "jurisdictions",
  "jurisdiction_identifiers",
  "jurisdiction_relations",
  "bodies",
  "seats",
  "roles",
  "channels",
  "products",
  "adoptions",
  "officials",
] as const;

export const proposeSchema = z.object({
  tableName: z.enum(PROPOSABLE_TABLES),
  // Client-generated UUID for inserts (so the id is known before the row
  // exists — every table here uses a uuid primary key), or the existing
  // row's id for update/delete.
  recordId: z.string().uuid(),
  op: z.enum(REVISION_OPS),
  diff: z.record(z.string(), z.unknown()),
  sourceUrl: z.string().url().optional(),
});

export type ProposeInput = z.infer<typeof proposeSchema>;
