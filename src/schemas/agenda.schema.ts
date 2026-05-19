import { z } from "zod";

export const AgendaIntentSchema = z.enum([
  "schedule",
  "reschedule",
  "cancel",
  "price_question",
  "general_question",
  "media",
  "audio",
  "inappropriate_internal_command",
  "registration",
  "none"
]);

export const SchedulingActionSchema = z.enum([
  "collect_preferences",
  "offer_slots",
  "reschedule",
  "cancel",
  "none"
]);

export const AgendaParserOutputSchema = z.object({
  intent: AgendaIntentSchema,
  scheduling_action: SchedulingActionSchema,
  clinical_risk: z.enum(["none", "low", "medium", "high"]),
  needs_doctor: z.boolean(),
  should_pause_ai: z.boolean(),
  patient_profile: z.object({
    name: z.string().nullable(),
    phone: z.string().nullable(),
    known_patient: z.boolean().nullable(),
    notes: z.string().nullable()
  }),
  appointment_preferences: z.object({
    dates: z.array(z.string()),
    periods: z.array(z.enum(["morning", "afternoon", "evening", "any"])),
    urgency: z.enum(["low", "normal", "high"]),
    reason: z.string().nullable()
  }),
  registration_data: z.object({
    name: z.string().nullable(),
    cpf: z.string().nullable(),
    birth_date: z.string().nullable(),
    insurance: z.string().nullable()
  }),
  raw_summary: z.string(),
  confidence: z.number().min(0).max(1)
});

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
export type AgendaParserOutput = z.infer<typeof AgendaParserOutputSchema>;
