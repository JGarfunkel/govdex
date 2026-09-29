import { z } from "zod";
import { CHANNEL_KINDS } from "../enums";

// Body for POST /candidates/:id/promote. A scribe promotes a spider-found
// link into a real channel on an existing body, a new body, a body's
// "boards & committees" index page (link_type='index'), a jurisdiction's
// code/local-laws page (link_type='vendor', guessed_function='code_publishing'),
// a body's own agenda/minutes page (link_type='agenda'/'minutes'/'agenda_minutes'),
// a jurisdiction's budget page (link_type='budget'), a civic-data API
// endpoint (link_type='api') onto open_data_api_url/legistar_api_url — see
// ingestion/tools/probe-civic-apis.ts — a jurisdiction's meeting calendar
// (link_type='calendar'), a special-district jurisdiction matched or created
// from a link_type='district' find (see jurisdiction_relations), or a
// GovTech vendor adoption matched or created from a link_type='vendor' find
// whose guessed_function isn't code_publishing (see products/adoptions).
export const candidatePromoteSchema = z.discriminatedUnion("promoteAs", [
  z.object({
    promoteAs: z.literal("channel"),
    bodyId: z.string().uuid(),
    kind: z.enum(CHANNEL_KINDS),
    platform: z.string().min(1).optional(),
  }),
  z.object({
    promoteAs: z.literal("body"),
    jurisdictionId: z.string().uuid(),
    categoryCode: z.string().min(1),
    name: z.string().min(1),
  }),
  z.object({
    promoteAs: z.literal("committeesUrl"),
    bodyId: z.string().uuid(),
  }),
  z.object({
    promoteAs: z.literal("policyUrl"),
    jurisdictionId: z.string().uuid(),
  }),
  z.object({
    promoteAs: z.literal("budgetUrl"),
    jurisdictionId: z.string().uuid(),
  }),
  z.object({
    promoteAs: z.literal("openDataApiUrl"),
    jurisdictionId: z.string().uuid(),
  }),
  z.object({
    promoteAs: z.literal("legistarApiUrl"),
    jurisdictionId: z.string().uuid(),
  }),
  z.object({
    promoteAs: z.literal("agendaUrl"),
    bodyId: z.string().uuid(),
  }),
  z.object({
    promoteAs: z.literal("minutesUrl"),
    bodyId: z.string().uuid(),
  }),
  z.object({
    promoteAs: z.literal("agendaMinutesUrl"),
    bodyId: z.string().uuid(),
  }),
  z.object({
    promoteAs: z.literal("calendarUrl"),
    jurisdictionId: z.string().uuid(),
  }),
  z.object({
    promoteAs: z.literal("districtLink"),
    jurisdictionId: z.string().uuid(), // the existing matched district
    relation: z.enum(["within", "overlaps", "coextensive"]),
    coverage: z.enum(["full", "partial"]),
  }),
  z.object({
    promoteAs: z.literal("districtCreate"),
    name: z.string().min(1),
    conceptCode: z.enum(["school_district", "special_district"]),
    relation: z.enum(["within", "overlaps", "coextensive"]),
    coverage: z.enum(["full", "partial"]),
  }),
  z.object({
    promoteAs: z.literal("adoptionLink"),
    bodyId: z.string().uuid().optional(), // omit = the jurisdiction itself adopted it
    productId: z.string().uuid(),
  }),
  z.object({
    promoteAs: z.literal("adoptionCreate"),
    bodyId: z.string().uuid().optional(), // omit = the jurisdiction itself adopted it
    vendor: z.string().min(1),
    productName: z.string().min(1),
    functionCode: z.string().min(1),
  }),
]);

export type CandidatePromoteInput = z.infer<typeof candidatePromoteSchema>;
