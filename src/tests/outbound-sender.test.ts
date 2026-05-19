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
      sendStatus: "pending",
      sentAt: null,
      providerMessageId: null,
      sendError: null,
      sendAttempts: 0
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
      sendStatus: input.sendStatus ?? "draft",
      sentAt: null,
      providerMessageId: null,
      sendError: null,
      sendAttempts: 0
    };
    this.messages.push(message);
    return message;
  }

  async findPendingOutboundForSend(limit = 5): Promise<OutboundDraftMessageRecord[]> {
    return this.messages.filter(
      (message) =>
        !message.sentAt &&
        message.sendStatus === "pending"
    ).slice(0, limit);
  }

  async markOutboundSending(
    messageId: string,
    lockId: string
  ): Promise<OutboundDraftMessageRecord | null> {
    const message = this.messages.find((item) => item.id === messageId);
    if (!message || message.sentAt || message.sendStatus !== "pending") {
      return null;
    }

    message.sendStatus = "sending";
    message.lockId = lockId;
    message.lockedAt = new Date().toISOString();
    message.sendAttempts = (message.sendAttempts ?? 0) + 1;
    return message;
  }

  async queueLatestOutboundDraft(phone: string): Promise<OutboundDraftMessageRecord | null> {
    const draft = [...this.messages]
      .reverse()
      .find((message) => message.phone === phone && message.sendStatus === "draft" && !message.sentAt);

    if (!draft) {
      return null;
    }

    draft.sendStatus = "pending";
    return draft;
  }

  async markOutboundSkipped(
    messageId: string,
    metadata: Record<string, unknown>
  ): Promise<MessageRecord> {
    const message = this.getMessage(messageId);
    message.sendStatus = "skipped";
    message.lockId = null;
    message.lockedAt = null;
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
    message.lockId = null;
    message.lockedAt = null;
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
    message.lockId = null;
    message.lockedAt = null;
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
  initialStatus?: OutboundDraftMessageRecord["sendStatus"] | null;
}) {
  const messagesRepository = new FakeMessagesRepository();
  if (options.initialStatus !== undefined) {
    messagesRepository.messages[0].sendStatus = options.initialStatus;
  }
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

    expect(summary).toMatchObject({ processed: 0, skipped: 0, sent: 0, failed: 0 });
    expect(services.zapiCalls).toHaveLength(0);
    expect(services.messagesRepository.messages[0].sendStatus).toBe("pending");
    expect(services.auditLogsRepository.logs.map((log) => log.event)).toContain(
      "outbound_send_skipped"
    );
  });

  it("findPendingOutboundForSend does not return draft or null status", async () => {
    const repository = new FakeMessagesRepository();
    repository.messages = [
      { ...repository.messages[0], id: "draft", sendStatus: "draft" },
      { ...repository.messages[0], id: "null", sendStatus: null },
      { ...repository.messages[0], id: "pending", sendStatus: "pending" }
    ];

    const pending = await repository.findPendingOutboundForSend();

    expect(pending.map((message) => message.id)).toEqual(["pending"]);
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

    const secondSummary = await services.sender.sendPending();

    expect(secondSummary.processed).toBe(0);
    expect(services.zapiCalls).toHaveLength(1);
  });

  it("queue-latest-draft marks only the latest draft for one phone as pending", async () => {
    const services = createSender({
      sendWhatsappEnabled: true,
      whatsappMode: "test",
      initialStatus: "draft"
    });
    services.messagesRepository.messages.push(
      {
        ...services.messagesRepository.messages[0],
        id: "outbound-2",
        sendStatus: "draft",
        text: "Mais recente"
      },
      {
        ...services.messagesRepository.messages[0],
        id: "other-phone",
        phone: "5561888888888",
        sendStatus: "draft"
      }
    );

    const queued = await services.sender.queueLatestDraft("5561999999999");

    expect(queued?.id).toBe("outbound-2");
    expect(services.messagesRepository.messages.map((message) => [message.id, message.sendStatus])).toEqual([
      ["outbound-1", "draft"],
      ["outbound-2", "pending"],
      ["other-phone", "draft"]
    ]);
  });

  it("send-pending with limit 1 sends at most one pending message", async () => {
    const services = createSender({ sendWhatsappEnabled: true, whatsappMode: "test" });
    services.messagesRepository.messages.push({
      ...services.messagesRepository.messages[0],
      id: "outbound-2",
      sendStatus: "pending"
    });

    const summary = await services.sender.sendPending(1);

    expect(summary.processed).toBe(1);
    expect(services.zapiCalls).toHaveLength(1);
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
      processed: 0,
      sent: 0,
      skipped: 0,
      failed: 0
    });

    await app.close();
  });

  it("POST /internal/outbound/queue-latest-draft queues one draft", async () => {
    const services = createSender({
      sendWhatsappEnabled: true,
      whatsappMode: "test",
      initialStatus: "draft"
    });
    const app = buildApp({
      dependencies: {
        outboundMessageSenderService: services.sender
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/outbound/queue-latest-draft",
      payload: { phone: "5561999999999" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      queued: 1,
      messageId: "outbound-1"
    });

    await app.close();
  });
});
