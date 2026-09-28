import { z } from "zod";

// Body for POST /revisions/:id/accept. The revision id itself comes from the
// URL param; this is just an optional note the accepting lead/editor can
// attach (stored nowhere yet, reserved for a future review-note column).
export const revisionAcceptSchema = z.object({
  note: z.string().max(2000).optional(),
});

export type RevisionAcceptInput = z.infer<typeof revisionAcceptSchema>;
