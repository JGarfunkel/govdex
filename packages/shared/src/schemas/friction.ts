import { z } from "zod";
import { MANUAL_FRICTION_TYPES } from "../enums";

// Body for POST /frictions — a scribe filing a friction the spider
// can't judge on its own (see MANUAL_FRICTION_TYPES). Starts at
// status='confirmed' since a human already made the call.
export const createFrictionSchema = z.object({
  jurisdictionId: z.string().uuid(),
  bodyId: z.string().uuid().optional(),
  patternType: z.enum(MANUAL_FRICTION_TYPES),
  pageUrl: z.string().url(),
  summary: z.string().min(1),
  detail: z.string().min(1).optional(),
  sourceUrl: z.string().url().optional(),
});

export type CreateFrictionInput = z.infer<typeof createFrictionSchema>;
