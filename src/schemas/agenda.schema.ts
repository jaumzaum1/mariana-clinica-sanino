import { z } from "zod";

export const AppointmentIntentSchema = z.enum([
  "schedule",
  "reschedule",
  "cancel",
  "ask_availability",
  "none"
]);

export const AgendaParserResultSchema = z.object({
  intent: AppointmentIntentSchema,
  patientName: z.string().optional(),
  phone: z.string().optional(),
  preferredDates: z.array(z.string()).default([]),
  preferredPeriod: z.enum(["morning", "afternoon", "evening", "any"]).default("any"),
  specialtyOrReason: z.string().optional(),
  confidence: z.number().min(0).max(1),
  needsHumanReview: z.boolean().default(false)
});

export type AgendaParserResult = z.infer<typeof AgendaParserResultSchema>;
export type AppointmentIntent = z.infer<typeof AppointmentIntentSchema>;
