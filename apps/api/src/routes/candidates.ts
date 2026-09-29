import { Router } from "express";
import { candidatePromoteSchema } from "@govdex/shared";
import { getPool } from "../db";
import { authMiddleware } from "../auth";
import { withUser } from "../withUser";
import { canEditField } from "../permissions";

export const candidatesRouter = Router();

// GET /candidates?jurisdiction=… — triage queue of spider-found links.
candidatesRouter.get("/candidates", authMiddleware, async (req, res) => {
  const jurisdictionId = typeof req.query.jurisdiction === "string" ? req.query.jurisdiction : null;
  const pool = getPool();
  const { rows } = await pool.query(
    // Excludes a 'new' board/channel candidate that's already registered —
    // matched by name against bodies, or by url against channels — even
    // though crawlSeed.ts's own dedup (see its knownBodies/knownChannelUrls
    // checks) means this mostly only fires for a row discovered before that
    // registration happened (e.g. a scribe added the body/channel by hand
    // rather than via promote). No need to make a scribe triage a find
    // that's already on file.
    `select * from candidate_links cl
      where status = 'new' and ($1::uuid is null or jurisdiction_id = $1)
        and not (
          cl.link_type = 'board' and exists (
            select 1 from bodies b
             where b.jurisdiction_id = cl.jurisdiction_id
               and lower(trim(b.name)) = lower(trim(cl.guessed_body_name))
          )
        )
        and not (
          cl.link_type = 'channel' and exists (
            select 1 from channels c join bodies b on b.id = c.body_id
             where b.jurisdiction_id = cl.jurisdiction_id
               and c.url = cl.target_url
          )
        )
      order by discovered_at desc`,
    [jurisdictionId],
  );
  res.json({ candidates: rows });
});

// POST /candidates/:id/promote — a scribe reviews a candidate and promotes it
// into a real channel or body. The spider only ever proposes; this is the
// human, permission-checked action that makes it real (origin='manual').
candidatesRouter.post("/candidates/:id/promote", authMiddleware, async (req, res) => {
  const parsed = candidatePromoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request body", issues: parsed.error.issues });
    return;
  }
  const input = parsed.data;
  const user = req.govdexUser!;

  try {
    const result = await withUser(user.id, async (client) => {
      const { rows } = await client.query("select * from candidate_links where id = $1 for update", [req.params.id]);
      const candidate = rows[0];
      if (!candidate) throw Object.assign(new Error("Candidate not found"), { status: 404 });
      if (candidate.status !== "new") {
        throw Object.assign(new Error(`Candidate is already ${candidate.status}`), { status: 409 });
      }

      if (input.promoteAs === "channel") {
        const allowed = await canEditField(user.id, "channels", null, candidate.jurisdiction_id);
        if (!allowed) throw Object.assign(new Error("Not permitted to create a channel here"), { status: 403 });
        await client.query(
          `insert into channels (body_id, kind, status, platform, url, source_url)
           values ($1, $2, 'present', $3, $4, $5)`,
          [input.bodyId, input.kind, input.platform ?? candidate.guessed_platform, candidate.target_url, candidate.found_on_url],
        );
      } else if (input.promoteAs === "body") {
        const allowed = await canEditField(user.id, "bodies", null, input.jurisdictionId);
        if (!allowed) throw Object.assign(new Error("Not permitted to create a body here"), { status: 403 });
        const { rows: categoryRows } = await client.query("select id from body_categories where code = $1", [input.categoryCode]);
        if (!categoryRows[0]) throw Object.assign(new Error(`Unknown body category ${input.categoryCode}`), { status: 400 });
        await client.query(
          `insert into bodies (jurisdiction_id, category_id, name, is_governmental, website, source_url)
           values ($1, $2, $3, false, $4, $5)`,
          [input.jurisdictionId, categoryRows[0].id, input.name, candidate.target_url, candidate.found_on_url],
        );
      } else if (input.promoteAs === "committeesUrl") {
        // link_type='index' — a "Boards & Committees" hub page, promoted onto
        // the body it's authoritative for rather than created as a body of
        // its own — see bodies.committees_url in schema.sql.
        const allowed = await canEditField(user.id, "bodies", "committees_url", candidate.jurisdiction_id);
        if (!allowed) throw Object.assign(new Error("Not permitted to set this body's committees url"), { status: 403 });
        await client.query(`update bodies set committees_url = $1, source_url = $2 where id = $3`, [
          candidate.target_url,
          candidate.found_on_url,
          input.bodyId,
        ]);
      } else if (input.promoteAs === "policyUrl") {
        // link_type='vendor', guessed_function='code_publishing' — a
        // Municode/eCode360-style code-publishing page, promoted onto the
        // jurisdiction's policy_url ("laws" glyph) — see jurisdictions.policy_url.
        const allowed = await canEditField(user.id, "jurisdictions", "policy_url", input.jurisdictionId);
        if (!allowed) throw Object.assign(new Error("Not permitted to set this jurisdiction's policy url"), { status: 403 });
        await client.query(`update jurisdictions set policy_url = $1 where id = $2`, [candidate.target_url, input.jurisdictionId]);
      } else if (input.promoteAs === "budgetUrl") {
        // link_type='budget' — a jurisdiction's budget page/document,
        // promoted onto jurisdictions.budget_url (the "budget" glyph) — see
        // ingestion/spider/budgetDetector.ts.
        const allowed = await canEditField(user.id, "jurisdictions", "budget_url", input.jurisdictionId);
        if (!allowed) throw Object.assign(new Error("Not permitted to set this jurisdiction's budget url"), { status: 403 });
        await client.query(`update jurisdictions set budget_url = $1 where id = $2`, [candidate.target_url, input.jurisdictionId]);
      } else if (input.promoteAs === "openDataApiUrl") {
        // link_type='api', guessed_function='open_data' — a Socrata/ArcGIS/
        // data.gov catalog endpoint, promoted onto jurisdictions.open_data_api_url
        // — see ingestion/tools/probe-civic-apis.ts.
        const allowed = await canEditField(user.id, "jurisdictions", "open_data_api_url", input.jurisdictionId);
        if (!allowed) throw Object.assign(new Error("Not permitted to set this jurisdiction's open data API url"), { status: 403 });
        await client.query(`update jurisdictions set open_data_api_url = $1 where id = $2`, [candidate.target_url, input.jurisdictionId]);
      } else if (input.promoteAs === "legistarApiUrl") {
        // link_type='api', guessed_function='legistar' — a Legistar API base,
        // promoted onto jurisdictions.legistar_api_url (source for boards +
        // seats listings) — see ingestion/tools/probe-civic-apis.ts.
        const allowed = await canEditField(user.id, "jurisdictions", "legistar_api_url", input.jurisdictionId);
        if (!allowed) throw Object.assign(new Error("Not permitted to set this jurisdiction's Legistar API url"), { status: 403 });
        await client.query(`update jurisdictions set legistar_api_url = $1 where id = $2`, [candidate.target_url, input.jurisdictionId]);
      } else if (input.promoteAs === "calendarUrl") {
        // link_type='calendar' — a jurisdiction-wide meeting/agenda calendar
        // link, promoted onto jurisdictions.calendar_url (the "calendar"
        // glyph), same pattern as budgetUrl above.
        const allowed = await canEditField(user.id, "jurisdictions", "calendar_url", input.jurisdictionId);
        if (!allowed) throw Object.assign(new Error("Not permitted to set this jurisdiction's calendar url"), { status: 403 });
        await client.query(`update jurisdictions set calendar_url = $1 where id = $2`, [candidate.target_url, input.jurisdictionId]);
      } else if (input.promoteAs === "districtLink" || input.promoteAs === "districtCreate") {
        // link_type='district' — a special district (school/fire/sewer/
        // water) is never a body; it's its own jurisdiction, linked to the
        // jurisdiction it was found on via jurisdiction_relations. 'Link'
        // matches to an existing jurisdiction (e.g. one t01b-school-districts
        // already imported); 'Create' mints a new one when no match exists.
        // Both jurisdiction creation and jurisdiction_relations writes are
        // gated editor/admin at the DB level (see field_policies) — a scoped
        // scribe cannot do either, by design.
        let districtId: string;
        if (input.promoteAs === "districtCreate") {
          const allowed = await canEditField(user.id, "jurisdictions", null, null);
          if (!allowed) throw Object.assign(new Error("Not permitted to create a new jurisdiction"), { status: 403 });
          const { rows: jurRows } = await client.query("select profile_id from jurisdictions where id = $1", [candidate.jurisdiction_id]);
          if (!jurRows[0]) throw Object.assign(new Error("Candidate's jurisdiction not found"), { status: 404 });
          const { rows: conceptRows } = await client.query("select id from type_concepts where code = $1", [input.conceptCode]);
          if (!conceptRows[0]) throw Object.assign(new Error(`Unknown concept ${input.conceptCode}`), { status: 400 });
          const { rows: newJur } = await client.query(
            `insert into jurisdictions (name, profile_id, concept_id, source_url, origin)
             values ($1, $2, $3, $4, 'manual') returning id`,
            [input.name, jurRows[0].profile_id, conceptRows[0].id, candidate.target_url],
          );
          districtId = newJur[0].id;
        } else {
          const allowed = await canEditField(user.id, "jurisdiction_relations", null, candidate.jurisdiction_id);
          if (!allowed) throw Object.assign(new Error("Not permitted to link jurisdictions"), { status: 403 });
          districtId = input.jurisdictionId;
        }
        await client.query(
          `insert into jurisdiction_relations (from_id, to_id, relation, coverage, source_url, origin)
           values ($1, $2, $3, $4, $5, 'manual')
           on conflict (from_id, to_id, relation) do nothing`,
          [districtId, candidate.jurisdiction_id, input.relation, input.coverage, candidate.found_on_url],
        );
      } else if (input.promoteAs === "adoptionLink" || input.promoteAs === "adoptionCreate") {
        // link_type='vendor' (guessed_function other than code_publishing) —
        // a GovTech product adoption. 'Link' attaches to an existing products
        // row (scribe-tier, scoped through the adopting jurisdiction);
        // 'Create' mints a new products row first — products is a global
        // reference catalog gated editor/admin (field_policies), so only an
        // editor/admin can introduce a vendor's product to the catalog for
        // the first time, though any scoped scribe can record further
        // adoptions of it afterward via 'Link'.
        let productId: string;
        if (input.promoteAs === "adoptionCreate") {
          const allowed = await canEditField(user.id, "products", null, null);
          if (!allowed) throw Object.assign(new Error("Not permitted to add a new product to the catalog"), { status: 403 });
          const { rows: functionRows } = await client.query("select id from product_functions where code = $1", [input.functionCode]);
          if (!functionRows[0]) throw Object.assign(new Error(`Unknown product function ${input.functionCode}`), { status: 400 });
          const { rows: newProduct } = await client.query(
            `insert into products (vendor, name, function_id, origin)
             values ($1, $2, $3, 'manual')
             on conflict (name, vendor) do update set function_id = excluded.function_id
             returning id`,
            [input.vendor, input.productName, functionRows[0].id],
          );
          productId = newProduct[0].id;
        } else {
          const allowed = await canEditField(user.id, "adoptions", null, candidate.jurisdiction_id);
          if (!allowed) throw Object.assign(new Error("Not permitted to record an adoption here"), { status: 403 });
          productId = input.productId;
        }
        // The adopting party is the candidate's jurisdiction (it's the
        // jurisdiction that licenses the software); bodyId narrows it to one
        // body of that jurisdiction, and the composite FK rejects any other.
        const conflictTarget = input.bodyId
          ? "(body_id, product_id) where body_id is not null"
          : "(jurisdiction_id, product_id) where body_id is null";
        await client.query(
          `insert into adoptions (jurisdiction_id, body_id, product_id, instance_url, source_url, origin)
           values ($1, $2, $3, $4, $5, 'manual')
           on conflict ${conflictTarget} do update set instance_url = excluded.instance_url`,
          [candidate.jurisdiction_id, input.bodyId ?? null, productId, candidate.target_url, candidate.target_url],
        );
      } else {
        // link_type='agenda'/'minutes'/'agenda_minutes' — a meeting-record
        // page matched by name to an existing body (see
        // ingestion/spider/agendaDetector.ts), promoted onto that body's
        // agenda_url and/or minutes_url.
        const columns =
          input.promoteAs === "agendaUrl"
            ? ["agenda_url"]
            : input.promoteAs === "minutesUrl"
              ? ["minutes_url"]
              : ["agenda_url", "minutes_url"];
        for (const column of columns) {
          const allowed = await canEditField(user.id, "bodies", column, candidate.jurisdiction_id);
          if (!allowed) throw Object.assign(new Error(`Not permitted to set this body's ${column}`), { status: 403 });
        }
        await client.query(`update bodies set ${columns.map((c) => `${c} = $1`).join(", ")} where id = $2`, [
          candidate.target_url,
          input.bodyId,
        ]);
      }

      // Promoting/linking is an update to the jurisdiction the candidate was
      // found on. Some targets (channels, adoptions, relations) don't bump
      // jurisdictions.updated_at themselves, so touch it explicitly — the
      // set_updated_at trigger stamps it.
      await client.query("update jurisdictions set updated_at = now() where id = $1", [candidate.jurisdiction_id]);

      await client.query(
        "update candidate_links set status = 'promoted', reviewed_by = $1, reviewed_at = now() where id = $2",
        [user.id, candidate.id],
      );
      return { candidateId: candidate.id, status: "promoted" };
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.status ?? 500).json({ message: err.message ?? "Failed to promote candidate" });
  }
});

// POST /candidates/:id/reject — a scribe dismisses a spider find that isn't
// worth promoting (mis-detected, or a duplicate the GET /candidates dedup
// above doesn't catch). No specific field is being written, so this checks
// candidate_links itself, which — like frictions — has no field_policies row
// and so falls back to the default scribe tier.
candidatesRouter.post("/candidates/:id/reject", authMiddleware, async (req, res) => {
  const user = req.govdexUser!;

  try {
    const result = await withUser(user.id, async (client) => {
      const { rows } = await client.query("select * from candidate_links where id = $1 for update", [req.params.id]);
      const candidate = rows[0];
      if (!candidate) throw Object.assign(new Error("Candidate not found"), { status: 404 });
      if (candidate.status !== "new") {
        throw Object.assign(new Error(`Candidate is already ${candidate.status}`), { status: 409 });
      }
      const allowed = await canEditField(user.id, "candidate_links", null, candidate.jurisdiction_id);
      if (!allowed) throw Object.assign(new Error("Not permitted to review candidates here"), { status: 403 });

      await client.query(
        "update candidate_links set status = 'rejected', reviewed_by = $1, reviewed_at = now() where id = $2",
        [user.id, candidate.id],
      );
      return { candidateId: candidate.id, status: "rejected" };
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.status ?? 500).json({ message: err.message ?? "Failed to reject candidate" });
  }
});
