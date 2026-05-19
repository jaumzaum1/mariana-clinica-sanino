import { z } from "zod";

export const ZapiWebhookSchema = z
  .object({
    phone: z.string().optional(),
    fromMe: z.boolean().optional(),
    text: z
      .object({
        message: z.string().optional()
      })
      .optional(),
    messageId: z.string().optional(),
    type: z.string().optional()
  })
  .passthrough();

export type ZapiWebhook = z.infer<typeof ZapiWebhookSchema>;
