import { env } from "../config/env.js";

export interface SendWhatsappMessageInput {
  phone: string;
  message: string;
  delayTyping?: number;
}

export interface SendWhatsappMessageResult {
  provider: "zapi";
  messageId?: string;
  rawResponse?: unknown;
}

export class ZapiService {
  constructor(
    private readonly config = {
      baseUrl: env.ZAPI_BASE_URL,
      instanceId: env.ZAPI_INSTANCE_ID,
      token: env.ZAPI_TOKEN,
      clientToken: env.ZAPI_CLIENT_TOKEN
    }
  ) {}

  async sendTextMessage(input: SendWhatsappMessageInput): Promise<SendWhatsappMessageResult> {
    if (!this.config.baseUrl || !this.config.instanceId || !this.config.token) {
      throw new Error("Credenciais Z-API incompletas para envio.");
    }

    const baseUrl = this.config.baseUrl.replace(/\/$/, "");
    const response = await fetch(
      `${baseUrl}/instances/${this.config.instanceId}/token/${this.config.token}/send-text`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.clientToken ? { "Client-Token": this.config.clientToken } : {})
        },
        body: JSON.stringify({
          phone: input.phone,
          message: input.message,
          delayTyping: input.delayTyping
        })
      }
    );

    const rawResponse = await response.json().catch(() => undefined);

    if (!response.ok) {
      throw new Error(`Z-API send-text failed with status ${response.status}`);
    }

    return {
      provider: "zapi",
      messageId: this.extractMessageId(rawResponse),
      rawResponse
    };
  }

  async sendMessage(input: SendWhatsappMessageInput): Promise<SendWhatsappMessageResult> {
    return this.sendTextMessage(input);
  }

  private extractMessageId(rawResponse: unknown): string | undefined {
    if (!rawResponse || typeof rawResponse !== "object") {
      return undefined;
    }

    const response = rawResponse as Record<string, unknown>;
    const candidates = [response.messageId, response.id, response.zaapId];
    const found = candidates.find((value): value is string => typeof value === "string");

    return found;
  }
}
