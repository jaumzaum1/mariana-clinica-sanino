import { describe, expect, it } from "vitest";
import type {
  AuditLogsRepository,
  CreateAuditLogInput,
  MessageRecord,
  MessagesRepository,
  OutboundDraftMessageRecord,
  SaveMessageInput,
  SaveOutboundDraftInput
} from "../repositories/types.js";
import { buildApp } from "../server/app.js";
import { AuditLogService } from "../services/audit-log.service.js";
import { OutboundMessageSenderService } from "../services/outbound-message-sender.service.js";
import type { SendWhatsappMessageInput } from "../services/zapi.service.js";

class FakeMessagesRepository implements MessagesRepository {
  messages: OutboundDraftMessageRecord[] = [
    {
      id: "outbound-1",
      patientId: "patient-1",
      phone: "5561999999999",
      text: "Mensagem de teste",
      rawPayload: { mariana: { draft: true, sent: false } },
      sendStatus: "draft",
      sentAt: null,
      providerMessageId: null,
      sendError: null
    }
  ];

  async saveInbound(input: SaveMessageInput): Promise<MessageRecord> {
    return {
      id: "inbound-1",
      patientId: input.patientId,
      phone: input.phone,
      text: input.text
    };
  }

  async saveOutboundDraft(input: SaveOutboundDraftInput): Promise<MessageRecord> {
    const message: OutboundDraftMessageRecord = {
      id: `outbound-${this.messages.length + 1}`,
      patientId: input.patientId,
      phone: input.phone,
      text: input.text,
      rawPayload: { mariana: input.metadata },
      sendStatus: "draft",
      sentAt: null,
      providerMessageId: null,
      sendError: null
    };
    this.messages.push(message);
    return message;
  }

  async findPendingOutboundDrafts(): Promise<OutboundDraftMessageRecord[]> {
    return this.messages.filter(
      (message) =>
        !message.sentAt &&
        message.sendStatus !== "sent" &&
        message.sendStatus !== "processing"
    );
  }

  async markOutboundProcessing(messageId: string): Promise<OutboundDraftMessageRecord | null> {
    const message = this.messages.find((item) => item.id === messageId);
    if (!message || message.sentAt || message.sendStatus === "sent" || message.sendStatus === "processing") {
      return null;
    }

    message.sendStatus = "processing";
    return message;
  }

  async markOutboundSkipped(
    messageId: string,
    metadata: Record<string, unknown>
  ): Promise<MessageRecord> {
    const message = this.getMessage(messageId);
    message.sendStatus = "skipped";
    message.rawPayload = { mariana: { ...this.getMarianaMetadata(message), ...metadata, sent: false } };
    return message;
  }

  async markOutboundSent(
    messageId: string,
    providerMessageId: string | undefined,
    metadata: Record<string, unknown>
  ): Promise<MessageRecord> {
    const message = this.getMessage(messageId);
    message.sendStatus = "sent";
    message.sentAt = new Date().toISOString();
    message.providerMessageId = providerMessageId;
    message.rawPayload = { mariana: { ...this.getMarianaMetadata(message), ...metadata, sent: true } };
    return message;
  }

  async markOutboundSendFailed(
    messageId: string,
    error: string,
    metadata: Record<string, unknown>
  ): Promise<MessageRecord> {
    const message = this.getMessage(messageId);
    message.sendStatus = "send_failed";
    message.sendError = error;
    message.rawPayload = {
      mariana: { ...this.getMarianaMetadata(message), ...metadata, sent: false, send_error: error }
    };
    return message;
  }

  private getMessage(messageId: string): OutboundDraftMessageRecord {
    const message = this.messages.find((item) => item.id === messageId);
    if (!message) {
      throw new Error(`Message not found: ${messageId}`);
    }
    return message;
  }

  private getMarianaMetadata(message: OutboundDraftMessageRecord): Record<string, unknown> {
    return message.rawPayload.mariana && typeof message.rawPayload.mariana === "object"
      ? (message.rawPayload.mariana as Record<string, unknown>)
      : {};
  }
}

class FakeAuditLogsRepository implements AuditLogsRepository {
  logs: CreateAuditLogInput[] = [];

  async create(input: CreateAuditLogInput): Promise<void> {
    this.logs.push(input);
  }
}

function createSender(options: {
  sendWhatsappEnabled: boolean;
  whatsappMode: "test" | "production";
  zapiThrows?: boolean;
  alreadySent?: boolean;
}) {
  const messagesRepository = new FakeMessagesRepository();
  if (options.alreadySent) {
    messagesRepository.messages[0].sendStatus = "sent";
    messagesRepository.messages[0].sentAt = new Date().toISOString();
  }
  const auditLogsRepository = new FakeAuditLogsRepository();
  const zapiCalls: SendWhatsappMessageInput[] = [];
  const sender = new OutboundMessageSenderService(
    messagesRepository,
    {
      sendTextMessage: async (input) => {
        zapiCalls.push(input);
        if (options.zapiThrows) {
          throw new Error("Z-API unavailable");
        }
        return {
          provider: "zapi",
          messageId: "zapi-message-1"
        };
      }
    },
    new AuditLogService(auditLogsRepository),
    {
      sendWhatsappEnabled: options.sendWhatsappEnabled,
      whatsappMode: options.whatsappMode,
      whatsappTestPhone: "556196531507"
    }
  );

  return {
    sender,
    messagesRepository,
    auditLogsRepository,
    zapiCalls
  };
}

describe("OutboundMessageSenderService", () => {
  it("skips and does not call Z-API when SEND_WHATSAPP_ENABLED=false", async () => {
    const services = createSender({ sendWhatsappEnabled: false, whatsappMode: "test" });

    const summary = await services.sender.sendPending();

    expect(summary).toMatchObject({ processed: 1, skipped: 1, sent: 0, failed: 0 });
    expect(services.zapiCalls).toHaveLength(0);
    expect(services.messagesRepository.messages[0].sendStatus).toBe("skipped");
    expect(services.auditLogsRepository.logs.map((log) => log.event)).toContain(
      "outbound_send_skipped"
    );
  });

  it("uses WHATSAPP_TEST_PHONE in test mode", async () => {
    const services = createSender({ sendWhatsappEnabled: true, whatsappMode: "test" });

    await services.sender.sendPending();

    expect(services.zapiCalls).toEqual([
      {
        phone: "556196531507",
        message: "Mensagem de teste"
      }
    ]);
    expect(services.messagesRepository.messages[0]).toMatchObject({
      sendStatus: "sent",
      providerMessageId: "zapi-message-1"
    });
  });

  it("uses the real patient phone in production mode", async () => {
    const services = createSender({ sendWhatsappEnabled: true, whatsappMode: "production" });

    await services.sender.sendPending();

    expect(services.zapiCalls[0].phone).toBe("5561999999999");
  });

  it("does not resend an already sent message", async () => {
    const services = createSender({
      sendWhatsappEnabled: true,
      whatsappMode: "test",
      alreadySent: true
    });

    const summary = await services.sender.sendPending();

    expect(summary.processed).toBe(0);
    expect(services.zapiCalls).toHaveLength(0);
  });

  it("keeps sent=false and records send_error when Z-API fails", async () => {
    const services = createSender({
      sendWhatsappEnabled: true,
      whatsappMode: "test",
      zapiThrows: true
    });

    const summary = await services.sender.sendPending();

    expect(summary).toMatchObject({ processed: 1, sent: 0, skipped: 0, failed: 1 });
    expect(services.messagesRepository.messages[0]).toMatchObject({
      sendStatus: "send_failed",
      sendError: "Z-API unavailable"
    });
    expect(services.auditLogsRepository.logs.map((log) => log.event)).toContain(
      "outbound_send_failed"
    );
  });

  it("POST /internal/outbound/send-pending works with mocks", async () => {
    const services = createSender({ sendWhatsappEnabled: false, whatsappMode: "test" });
    const app = buildApp({
      dependencies: {
        outboundMessageSenderService: services.sender
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/outbound/send-pending",
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      mode: "test",
      sendEnabled: false,
      processed: 1,
      sent: 0,
      skipped: 1,
      failed: 0
    });

    await app.close();
  });
});
