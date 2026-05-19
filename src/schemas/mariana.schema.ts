import { z } from "zod";

export const MarianaResponseSchema = z.object({
  message: z.string().min(1),
  tone: z.enum(["warm", "objective", "reassuring"]).default("warm"),
  shouldSend: z.boolean().default(true),
  suggestedFollowUpAt: z.string().datetime().optional(),
  handoffToHuman: z.boolean().default(false),
  tags: z.array(z.string()).default([])
});

export type MarianaResponse = z.infer<typeof MarianaResponseSchema>;
