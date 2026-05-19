import { z } from "zod";

export const ZapiWebhookSchema = z
  .object({
    phone: z.string().optional(),
    senderName: z.string().optional(),
    fromMe: z.boolean().optional(),
    text: z
      .object({
        message: z.string().optional()
      })
      .optional(),
    messageId: z.string().optional(),
    message: z.string().optional(),
    body: z.string().optional(),
    audio: z.unknown().optional(),
    image: z.unknown().optional(),
    document: z.unknown().optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
    type: z.string().optional()
  })
  .passthrough();

export const NormalizedZapiWebhookSchema = z.object({
  phone: z.string().min(10),
  phoneVariants: z.array(z.string()).min(1),
  senderName: z.string().optional(),
  messageId: z.string().optional(),
  text: z.string(),
  messageType: z.enum(["text", "audio", "image", "document", "unknown"]),
  timestamp: z.coerce.date().optional(),
  rawPayload: z.unknown()
});

export type ZapiWebhook = z.infer<typeof ZapiWebhookSchema>;
export type NormalizedZapiWebhook = z.infer<typeof NormalizedZapiWebhookSchema>;
