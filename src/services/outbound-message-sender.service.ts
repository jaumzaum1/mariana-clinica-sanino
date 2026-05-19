import type { MessagesRepository, OutboundDraftMessageRecord } from "../repositories/types.js";
import type { AuditLogService } from "./audit-log.service.js";
import type { ZapiService } from "./zapi.service.js";

export type WhatsappMode = "test" | "production";

export interface OutboundMessageSenderOptions {
  sendWhatsappEnabled: boolean;
  whatsappMode: WhatsappMode;
  whatsappTestPhone: string;
}

export interface OutboundSendSummary {
  mode: WhatsappMode;
  sendEnabled: boolean;
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
}

export class OutboundMessageSenderService {
  constructor(
    private readonly messagesRepository: MessagesRepository,
    private readonly zapiService: Pick<ZapiService, "sendTextMessage">,
    private readonly auditLogService: AuditLogService,
    private readonly options: OutboundMessageSenderOptions
  ) {}

  async sendPending(limit = 25): Promise<OutboundSendSummary> {
    const pendingMessages = await this.messagesRepository.findPendingOutboundDrafts(limit);
    const summary: OutboundSendSummary = {
      mode: this.options.whatsappMode,
      sendEnabled: this.options.sendWhatsappEnabled,
      processed: 0,
      sent: 0,
      skipped: 0,
      failed: 0
    };

    for (const pending of pendingMessages) {
      const message = await this.messagesRepository.markOutboundProcessing(pending.id);
      if (!message) {
        continue;
      }

      summary.processed += 1;
      const result = await this.processMessage(message);
      summary[result] += 1;
    }

    return summary;
  }

  private async processMessage(message: OutboundDraftMessageRecord): Promise<"sent" | "skipped" | "failed"> {
    if (!this.options.sendWhatsappEnabled) {
      await this.messagesRepository.markOutboundSkipped(message.id, {
        skipped_reason: "SEND_WHATSAPP_ENABLED=false",
        send_whatsapp_enabled: false,
        whatsapp_mode: this.options.whatsappMode
      });
      await this.auditLogService.create({
        event: "outbound_send_skipped",
        phone: message.phone,
        metadata: {
          messageId: message.id,
          reason: "SEND_WHATSAPP_ENABLED=false",
          mode: this.options.whatsappMode
        }
      });

      return "skipped";
    }

    const destinationPhone =
      this.options.whatsappMode === "test" ? this.options.whatsappTestPhone : message.phone;

    try {
      const result = await this.zapiService.sendTextMessage({
        phone: destinationPhone,
        message: message.text
      });

      await this.messagesRepository.markOutboundSent(message.id, result.messageId, {
        send_whatsapp_enabled: true,
        whatsapp_mode: this.options.whatsappMode,
        destination_phone: destinationPhone,
        provider: result.provider,
        provider_message_id: result.messageId
      });
      await this.auditLogService.create({
        event: "outbound_sent",
        phone: message.phone,
        metadata: {
          messageId: message.id,
          provider: result.provider,
          providerMessageId: result.messageId,
          mode: this.options.whatsappMode,
          destinationPhone
        }
      });

      return "sent";
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Erro desconhecido no envio Z-API.";
      await this.messagesRepository.markOutboundSendFailed(message.id, errorMessage, {
        send_whatsapp_enabled: true,
        whatsapp_mode: this.options.whatsappMode,
        destination_phone: destinationPhone
      });
      await this.auditLogService.create({
        event: "outbound_send_failed",
        phone: message.phone,
        metadata: {
          messageId: message.id,
          mode: this.options.whatsappMode,
          destinationPhone,
          error: errorMessage
        }
      });

      return "failed";
    }
  }
}
