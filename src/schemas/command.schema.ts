import { z } from "zod";

export const InternalCommandTypeSchema = z.enum(["ASSUMIR", "LIBERAR", "RESUMO", "OBS"]);

export const InternalCommandSchema = z.object({
  type: InternalCommandTypeSchema,
  phone: z.string().optional(),
  note: z.string().optional(),
  requestedBy: z.string().default("internal-test"),
  createdAt: z.coerce.date().default(() => new Date())
});

export const InternalCommandInputSchema = z.object({
  text: z.string().min(1),
  requestedBy: z.string().optional()
});

export type InternalCommandType = z.infer<typeof InternalCommandTypeSchema>;
export type InternalCommand = z.infer<typeof InternalCommandSchema>;
export type InternalCommandInput = z.infer<typeof InternalCommandInputSchema>;
