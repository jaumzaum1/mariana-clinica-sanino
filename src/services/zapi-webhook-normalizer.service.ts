import {
  NormalizedZapiWebhookSchema,
  ZapiWebhookSchema,
  type NormalizedZapiWebhook
} from "../schemas/webhook.schema.js";
import { generateBrazilWhatsappVariants, normalizeBrazilPhone } from "../utils/phone.js";

function extractText(payload: Record<string, unknown>): string {
  const text = payload.text;

  if (typeof text === "object" && text !== null && "message" in text) {
    const message = (text as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  if (typeof payload.body === "string") {
    return payload.body;
  }

  if (payload.audio) {
    return "[audio]";
  }

  if (payload.image) {
    return "[image]";
  }

  if (payload.document) {
    return "[document]";
  }

  return "";
}

function extractMessageType(payload: Record<string, unknown>): NormalizedZapiWebhook["messageType"] {
  if (payload.audio) {
    return "audio";
  }

  if (payload.image) {
    return "image";
  }

  if (payload.document) {
    return "document";
  }

  if (extractText(payload)) {
    return "text";
  }

  return "unknown";
}

export class ZapiWebhookNormalizerService {
  normalize(rawPayload: unknown): NormalizedZapiWebhook {
    const parsed = ZapiWebhookSchema.parse(rawPayload);
    const payload = parsed as Record<string, unknown>;

    if (!parsed.phone) {
      throw new Error("Webhook da Z-API sem telefone.");
    }

    const phone = normalizeBrazilPhone(parsed.phone);
    const normalized = {
      phone,
      phoneVariants: generateBrazilWhatsappVariants(phone),
      senderName: parsed.senderName,
      messageId: parsed.messageId,
      text: extractText(payload),
      messageType: extractMessageType(payload),
      timestamp: parsed.timestamp,
      rawPayload
    };

    return NormalizedZapiWebhookSchema.parse(normalized);
  }
}
