import { z } from "zod";

export const MarianaResponseOutputSchema = z.object({
  messages: z.array(z.string().min(1)).min(1),
  intent: z.string(),
  status: z.enum(["draft", "needs_doctor", "paused", "ready_to_send"]),
  tags_add: z.array(z.string()),
  tags_remove: z.array(z.string()),
  needs_doctor: z.boolean(),
  pause_ai: z.boolean(),
  handoff_reason: z.string().nullable(),
  calendar_action: z.enum(["none", "collect_preferences", "suggest_slots", "book"]),
  followup_action: z.enum(["none", "schedule_reminder"]),
  memory_summary: z.string().nullable()
});

export const MarianaResponseSchema = z.object({
  message: z.string().min(1),
  tone: z.enum(["warm", "objective", "reassuring"]).default("warm"),
  shouldSend: z.boolean().default(true),
  suggestedFollowUpAt: z.string().datetime().optional(),
  handoffToHuman: z.boolean().default(false),
  tags: z.array(z.string()).default([])
});

export type MarianaResponse = z.infer<typeof MarianaResponseSchema>;
export type MarianaResponseOutput = z.infer<typeof MarianaResponseOutputSchema>;
