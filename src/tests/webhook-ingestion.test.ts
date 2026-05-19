import { describe, expect, it } from "vitest";
import type {
  AuditLogsRepository,
  CreateAuditLogInput,
  MessageBatchRecord,
  MessageBatchesRepository,
  MessageRecord,
  MessagesRepository,
  OutboundDraftMessageRecord,
  PatientRecord,
  PatientsRepository,
  SaveMessageInput,
  SaveOutboundDraftInput,
  UpsertMessageBatchInput,
  UpsertPatientInput
} from "../repositories/types.js";
import { buildApp } from "../server/app.js";
import { AuditLogService } from "../services/audit-log.service.js";
import { MessageDebounceService } from "../services/message-debounce.service.js";
import { WebhookIngestionService } from "../services/webhook-ingestion.service.js";
import { ZapiWebhookNormalizerService } from "../services/zapi-webhook-normalizer.service.js";

class FakePatientsRepository implements PatientsRepository {
  patients: PatientRecord[] = [];

  async upsert(input: UpsertPatientInput): Promise<PatientRecord> {
    const existing = this.patients.find((patient) => patient.phone === input.phone);
    const patient = existing ?? {
      id: `patient-${this.patients.length + 1}`,
      phone: input.phone
    };

    patient.name = input.name;
    patient.metadata = { whatsapp_variants: input.phoneVariants };

    if (!existing) {
      this.patients.push(patient);
    }

    return patient;
  }

  async findByPhone(phone: string): Promise<PatientRecord | null> {
    return this.patients.find((patient) => patient.phone === phone) ?? null;
  }

  async updateMemorySummary(patientId: string, memorySummary: string): Promise<PatientRecord> {
    const patient = this.patients.find((item) => item.id === patientId);
    if (!patient) {
      throw new Error(`Patient not found: ${patientId}`);
    }

    patient.metadata = {
      ...patient.metadata,
      memory_summary: memorySummary
    };
    return patient;
  }
}

class FakeMessagesRepository implements MessagesRepository {
  messages: MessageRecord[] = [];

  async saveInbound(input: SaveMessageInput): Promise<MessageRecord> {
    const message = {
      id: `message-${this.messages.length + 1}`,
      patientId: input.patientId,
      phone: input.phone,
      text: input.text
    };

    this.messages.push(message);
    return message;
  }

  async saveOutboundDraft(input: SaveOutboundDraftInput): Promise<MessageRecord> {
    const message = {
      id: `message-${this.messages.length + 1}`,
      patientId: input.patientId,
      phone: input.phone,
      text: input.text
    };

    this.messages.push(message);
    return message;
  }

  async findPendingOutboundDrafts(): Promise<OutboundDraftMessageRecord[]> {
    return [];
  }

  async markOutboundProcessing(): Promise<OutboundDraftMessageRecord | null> {
    return null;
  }

  async markOutboundSkipped(messageId: string): Promise<MessageRecord> {
    return this.messages.find((message) => message.id === messageId) ?? this.messages[0];
  }

  async markOutboundSent(messageId: string): Promise<MessageRecord> {
    return this.messages.find((message) => message.id === messageId) ?? this.messages[0];
  }

  async markOutboundSendFailed(messageId: string): Promise<MessageRecord> {
    return this.messages.find((message) => message.id === messageId) ?? this.messages[0];
  }
}

class FakeAuditLogsRepository implements AuditLogsRepository {
  logs: CreateAuditLogInput[] = [];

  async create(input: CreateAuditLogInput): Promise<void> {
    this.logs.push(input);
  }
}

class FakeMessageBatchesRepository implements MessageBatchesRepository {
  batches: MessageBatchRecord[] = [];

  async upsertAccumulating(input: UpsertMessageBatchInput): Promise<MessageBatchRecord> {
    const existing = this.batches.find(
      (batch) => batch.phone === input.phone && batch.status === "accumulating"
    );

    if (existing) {
      existing.accumulatedText = [existing.accumulatedText, input.text].join("\n");
      existing.messageIds.push(input.messageId);
      existing.lastMessageAt = input.receivedAt.toISOString();
      existing.processAfter = input.processAfter.toISOString();
      return existing;
    }

    const batch: MessageBatchRecord = {
      id: `batch-${this.batches.length + 1}`,
      phone: input.phone,
      status: "accumulating",
      accumulatedText: input.text,
      messageIds: [input.messageId],
      lastMessageAt: input.receivedAt.toISOString(),
      processAfter: input.processAfter.toISOString()
    };

    this.batches.push(batch);
    return batch;
  }

  async findDue(now: Date): Promise<MessageBatchRecord[]> {
    return this.batches.filter(
      (batch) => batch.status === "accumulating" && new Date(batch.processAfter) <= now
    );
  }

  async findReady(): Promise<MessageBatchRecord[]> {
    return this.batches.filter((batch) => batch.status === "ready");
  }

  async markReady(id: string): Promise<MessageBatchRecord> {
    const batch = this.batches.find((item) => item.id === id);
    if (!batch) {
      throw new Error(`Batch not found: ${id}`);
    }

    batch.status = "ready";
    return batch;
  }

  async markProcessed(id: string, metadata: Record<string, unknown> = {}): Promise<MessageBatchRecord> {
    const batch = this.batches.find((item) => item.id === id);
    if (!batch) {
      throw new Error(`Batch not found: ${id}`);
    }

    batch.status = "processed";
    batch.metadata = { ...batch.metadata, ...metadata };
    return batch;
  }

  async markFailed(id: string, metadata: Record<string, unknown> = {}): Promise<MessageBatchRecord> {
    const batch = this.batches.find((item) => item.id === id);
    if (!batch) {
      throw new Error(`Batch not found: ${id}`);
    }

    batch.status = "failed";
    batch.metadata = { ...batch.metadata, ...metadata };
    return batch;
  }
}

function createTestServices() {
  const patientsRepository = new FakePatientsRepository();
  const messagesRepository = new FakeMessagesRepository();
  const auditLogsRepository = new FakeAuditLogsRepository();
  const messageBatchesRepository = new FakeMessageBatchesRepository();
  const loggerCalls: CreateAuditLogInput[] = [];
  const auditLogService = new AuditLogService(auditLogsRepository, {
    info: (input: CreateAuditLogInput) => loggerCalls.push(input)
  } as never);
  const debounceService = new MessageDebounceService(
    messageBatchesRepository,
    auditLogService,
    { windowMs: 5_000 }
  );
  const ingestionService = new WebhookIngestionService(
    new ZapiWebhookNormalizerService(),
    patientsRepository,
    messagesRepository,
    debounceService,
    auditLogService
  );

  return {
    patientsRepository,
    messagesRepository,
    auditLogsRepository,
    messageBatchesRepository,
    loggerCalls,
    debounceService,
    ingestionService
  };
}

describe("Z-API webhook ingestion", () => {
  it("receives a text message through the webhook route and returns 200", async () => {
    const services = createTestServices();
    const app = buildApp({
      dependencies: {
        webhookIngestionService: services.ingestionService
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/zapi",
      payload: {
        phone: "+55 (61) 99653-1507",
        senderName: "Maria",
        messageId: "zapi-1",
        text: { message: "Quero marcar consulta" }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      received: true,
      phone: "5561996531507"
    });

    await app.close();
  });

  it("saves the message, upserts patient, normalizes phone and logs main events", async () => {
    const services = createTestServices();

    await services.ingestionService.ingestZapiWebhook({
      phone: "+55 61 99653-1507",
      senderName: "Maria",
      messageId: "zapi-1",
      text: { message: "Boa tarde" }
    });

    expect(services.patientsRepository.patients).toHaveLength(1);
    expect(services.patientsRepository.patients[0]).toMatchObject({
      phone: "5561996531507",
      name: "Maria",
      metadata: {
        whatsapp_variants: ["5561996531507", "556196531507"]
      }
    });
    expect(services.messagesRepository.messages).toEqual([
      {
        id: "message-1",
        patientId: "patient-1",
        phone: "5561996531507",
        text: "Boa tarde"
      }
    ]);

    expect(services.auditLogsRepository.logs.map((log) => log.event)).toEqual([
      "webhook_received",
      "patient_upserted",
      "message_saved",
      "debounce_batch_updated"
    ]);
    expect(services.loggerCalls.map((log) => log.event)).toContain("message_saved");
  });

  it("accumulates two messages from the same phone in one debounce batch", async () => {
    const services = createTestServices();

    await services.ingestionService.ingestZapiWebhook({
      phone: "5561996531507",
      messageId: "zapi-1",
      message: "Oi"
    });
    await services.ingestionService.ingestZapiWebhook({
      phone: "5561996531507",
      messageId: "zapi-2",
      body: "Quero marcar"
    });

    expect(services.messageBatchesRepository.batches).toHaveLength(1);
    expect(services.messageBatchesRepository.batches[0]).toMatchObject({
      phone: "5561996531507",
      accumulatedText: "Oi\nQuero marcar",
      messageIds: ["message-1", "message-2"]
    });
  });

  it("marks due debounce batches as ready and writes audit log", async () => {
    const services = createTestServices();
    await services.ingestionService.ingestZapiWebhook({
      phone: "5561996531507",
      message: "Oi"
    });

    const processAfter = new Date(services.messageBatchesRepository.batches[0].processAfter);
    const readyBatches = await services.debounceService.processDueBatches(
      new Date(processAfter.getTime() + 1)
    );

    expect(readyBatches).toHaveLength(1);
    expect(readyBatches[0].status).toBe("ready");
    expect(services.auditLogsRepository.logs.map((log) => log.event)).toContain(
      "debounce_batch_ready"
    );
  });
});
