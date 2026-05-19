import { z } from "zod";

export const PatientSchema = z.object({
  id: z.string().uuid(),
  phone: z.string().min(10),
  name: z.string().min(1).optional(),
  notes: z.string().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date()
});

export const MessageDirectionSchema = z.enum(["inbound", "outbound", "internal"]);

export const MessageSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid().optional(),
  phone: z.string().min(10),
  direction: MessageDirectionSchema,
  text: z.string().default(""),
  rawPayload: z.unknown().optional(),
  createdAt: z.coerce.date()
});

export type Patient = z.infer<typeof PatientSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;
