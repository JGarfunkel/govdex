import type { Pool, PoolClient } from "pg";

// Idempotent-upsert-guarded-by-origin, implemented once and reused by every
// tranche. The rule throughout: match on jurisdiction_identifiers, never on
// names; a re-run never clobbers a row a scribe has touched (origin='manual');
// every insert here is explicit origin='import' (the schema column default is
// 'manual', for hand/UI-created rows — ingestion must say so explicitly).

// Ingestion scripts mostly run single statements against the shared pool
// rather than opening an explicit transaction per row, so every helper here
// accepts either a Pool or a checked-out PoolClient.
type Queryable = Pool | PoolClient;

export interface JurisdictionUpsert {
  scheme: string; // 'swis' | 'gnis' | 'beds' | 'ocd' | 'district_number' ...
  value: string;
  name: string;
  profileId: number;
  conceptId: number;
  website?: string | null;
  attributes?: Record<string, unknown>;
  sourceUrl?: string;
}

export async function upsertJurisdictionByIdentifier(client: Queryable, params: JurisdictionUpsert): Promise<string> {
  const existing = await client.query<{ id: string; origin: string }>(
    `select j.id, j.origin from jurisdiction_identifiers ji
       join jurisdictions j on j.id = ji.jurisdiction_id
      where ji.scheme = $1 and ji.value = $2`,
    [params.scheme, params.value],
  );

  if (existing.rows[0]) {
    const { id, origin } = existing.rows[0];
    if (origin === "import") {
      await client.query(
        // coalesce: a source that carries no website (MassGIS, say) must not
        // null out one a separate websites step or the spider already set.
        `update jurisdictions set name = $2, website = coalesce($3, website), attributes = attributes || $4::jsonb
          where id = $1 and origin = 'import'`,
        [id, params.name, params.website ?? null, JSON.stringify(params.attributes ?? {})],
      );
    }
    return id;
  }

  const inserted = await client.query<{ id: string }>(
    `insert into jurisdictions (name, profile_id, concept_id, website, attributes, source_url, origin)
     values ($1, $2, $3, $4, $5, $6, 'import')
     returning id`,
    [params.name, params.profileId, params.conceptId, params.website ?? null, JSON.stringify(params.attributes ?? {}), params.sourceUrl ?? null],
  );
  const id = inserted.rows[0].id;
  await addIdentifier(client, id, params.scheme, params.value, params.sourceUrl);
  return id;
}

export async function addIdentifier(client: Queryable, jurisdictionId: string, scheme: string, value: string, sourceUrl?: string) {
  await client.query(
    `insert into jurisdiction_identifiers (jurisdiction_id, scheme, value, source_url, origin)
     values ($1, $2, $3, $4, 'import')
     on conflict (scheme, value) do nothing`,
    [jurisdictionId, scheme, value, sourceUrl ?? null],
  );
}

export async function upsertRelation(
  client: Queryable,
  fromId: string,
  toId: string,
  relation: "within" | "overlaps" | "coextensive",
  coverage: "full" | "partial" = "full",
) {
  await client.query(
    `insert into jurisdiction_relations (from_id, to_id, relation, coverage, origin)
     values ($1, $2, $3, $4, 'import')
     on conflict (from_id, to_id, relation) do update
       set coverage = excluded.coverage
       where jurisdiction_relations.origin = 'import'`,
    [fromId, toId, relation, coverage],
  );
}

export async function upsertBodyByName(
  client: Queryable,
  params: {
    jurisdictionId: string;
    categoryId: number;
    name: string;
    isGovernmental?: boolean;
    website?: string | null;
    committeesUrl?: string | null;
    sourceUrl?: string;
    // 'source_cited' when the caller has a citable authoritative source (e.g.
    // a jurisdiction's own Legistar API — see legistar-bodies.ts) rather than
    // a spider text-guess. Only ever raises verification, never lowers it —
    // a scribe's 'scribe_verified'/'official_confirmed' always wins.
    verification?: "unverified" | "source_cited" | "scribe_verified" | "official_confirmed" | "disputed";
    parentBodyId?: string | null;
  },
): Promise<string> {
  // Match case/whitespace-insensitively (and on the same parent, if any) —
  // an exact-string match let two ingestion paths (or a re-run after an
  // upstream name tweak) silently create a second row for the same board
  // instead of updating the first. See ingestion/tools/dedupe-bodies.ts for
  // cleaning up duplicates that already exist, and migration 0016 for the DB
  // constraint that now backs this up.
  const existing = await client.query<{ id: string; origin: string; verification: string }>(
    `select id, origin, verification from bodies
      where jurisdiction_id = $1
        and lower(trim(name)) = lower(trim($2))
        and parent_body_id is not distinct from $3`,
    [params.jurisdictionId, params.name, params.parentBodyId ?? null],
  );
  if (existing.rows[0]) {
    const { id, origin, verification } = existing.rows[0];
    // Category/governmental can legitimately change on a re-import — e.g. a
    // Legistar re-fetch reclassifying a body from 'official_appointed' to
    // 'chief_executive' once a name-based override is added (see
    // ingestion/tools/legistar-bodies.ts's CHIEF_EXECUTIVE_NAME) — so these
    // sync unconditionally for import-origin rows, same as every other
    // re-derivable fact here; only a scribe's manual edit (origin='manual')
    // is ever left alone.
    if (origin === "import") {
      await client.query(`update bodies set category_id = $2, is_governmental = $3 where id = $1 and origin = 'import'`, [
        id,
        params.categoryId,
        params.isGovernmental ?? false,
      ]);
    }
    if (origin === "import" && params.website) {
      await client.query(`update bodies set website = $2 where id = $1 and origin = 'import'`, [id, params.website]);
    }
    if (origin === "import" && params.committeesUrl) {
      await client.query(`update bodies set committees_url = $2 where id = $1 and origin = 'import'`, [id, params.committeesUrl]);
    }
    if (origin === "import" && params.verification && verification === "unverified") {
      await client.query(`update bodies set verification = $2, source_url = coalesce(source_url, $3) where id = $1 and origin = 'import'`, [
        id,
        params.verification,
        params.sourceUrl ?? null,
      ]);
    }
    return id;
  }
  const inserted = await client.query<{ id: string }>(
    `insert into bodies (jurisdiction_id, category_id, name, is_governmental, website, committees_url, source_url, parent_body_id, verification, origin)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'import')
     returning id`,
    [
      params.jurisdictionId,
      params.categoryId,
      params.name,
      params.isGovernmental ?? false,
      params.website ?? null,
      params.committeesUrl ?? null,
      params.sourceUrl ?? null,
      params.parentBodyId ?? null,
      params.verification ?? "unverified",
    ],
  );
  return inserted.rows[0].id;
}
