import { describe, expect, it } from "vitest";
import type { AgendaParserOutput } from "../schemas/agenda.schema.js";
import type { MarianaResponseOutput } from "../schemas/mariana.schema.js";
import type {
  AuditLogsRepository,
  CreateAuditLogInput,
  MessageBatchRecord,
  MessageBatchesRepository,
  MessageRecord,
  MessagesRepository,
  PatientRecord,
  PatientsRepository,
  SaveMessageInput,
  SaveOutboundDraftInput,
  UpsertMessageBatchInput,
  UpsertPatientInput
} from "../repositories/types.js";
import { buildApp } from "../server/app.js";
import { AuditLogService } from "../services/audit-log.service.js";
import { ConversationProcessorService } from "../services/conversation-processor.service.js";
import { MessageBatchWorkerService } from "../services/message-batch-worker.service.js";
import { MessageDebounceService } from "../services/message-debounce.service.js";

const agendaOutput: AgendaParserOutput = {
  intent: "schedule",
  scheduling_action: "collect_preferences",
  clinical_risk: "none",
  needs_doctor: false,
  should_pause_ai: false,
  patient_profile: {
    name: null,
    phone: null,
    known_patient: null,
    notes: null
  },
  appointment_preferences: {
    dates: [],
    periods: ["morning"],
    urgency: "normal",
    reason: "Consulta"
  },
  registration_data: {
    name: null,
    cpf: null,
    birth_date: null,
    insurance: null
  },
  raw_summary: "Paciente quer marcar consulta.",
  confidence: 0.92
};

const marianaOutput: MarianaResponseOutput = {
  messages: ["Claro, posso te ajudar a organizar a consulta."],
  intent: "schedule",
  status: "draft",
  tags_add: ["agenda"],
  tags_remove: [],
  needs_doctor: false,
  pause_ai: false,
  handoff_reason: null,
  calendar_action: "collect_preferences",
  followup_action: "none",
  memory_summary: "Paciente demonstrou interesse em consulta."
};

class FakePatientsRepository implements PatientsRepository {
  patients: PatientRecord[] = [
    {
      id: "patient-1",
      phone: "5561996531507",
      metadata: {}
    }
  ];

  async upsert(input: UpsertPatientInput): Promise<PatientRecord> {
    const patient = {
      id: "patient-1",
      phone: input.phone,
      name: input.name,
      metadata: { whatsapp_variants: input.phoneVariants }
    };
    this.patients = [patient];
    return patient;
  }

  async findByPhone(phone: string): Promise<PatientRecord | null> {
    return this.patients.find((patient) => patient.phone === phone) ?? null;
  }

  async updateMemorySummary(patientId: string, memorySummary: string): Promise<PatientRecord> {
    const patient = this.patients.find((item) => item.id === patientId);
    if (!patient) {
      throw new Error("Patient not found");
    }

    patient.metadata = { ...patient.metadata, memory_summary: memorySummary };
    return patient;
  }
}

class FakeMessagesRepository implements MessagesRepository {
  inbound: MessageRecord[] = [];
  outboundDrafts: Array<MessageRecord & { metadata: SaveOutboundDraftInput["metadata"] }> = [];

  async saveInbound(input: SaveMessageInput): Promise<MessageRecord> {
    const message = {
      id: `inbound-${this.inbound.length + 1}`,
      patientId: input.patientId,
      phone: input.phone,
      text: input.text
    };
    this.inbound.push(message);
    return message;
  }

  async saveOutboundDraft(input: SaveOutboundDraftInput): Promise<MessageRecord> {
    const message = {
      id: `outbound-${this.outboundDrafts.length + 1}`,
      patientId: input.patientId,
      phone: input.phone,
      text: input.text,
      metadata: input.metadata
    };
    this.outboundDrafts.push(message);
    return message;
  }
}

class FakeAuditLogsRepository implements AuditLogsRepository {
  logs: CreateAuditLogInput[] = [];

  async create(input: CreateAuditLogInput): Promise<void> {
    this.logs.push(input);
  }
}

class FakeMessageBatchesRepository implements MessageBatchesRepository {
  batches: MessageBatchRecord[] = [
    {
      id: "batch-1",
      phone: "5561996531507",
      status: "ready",
      accumulatedText: "Quero marcar consulta",
      messageIds: ["message-1"],
      lastMessageAt: new Date().toISOString(),
      processAfter: new Date().toISOString(),
      metadata: {}
    }
  ];

  async upsertAccumulating(input: UpsertMessageBatchInput): Promise<MessageBatchRecord> {
    const batch: MessageBatchRecord = {
      id: "batch-new",
      phone: input.phone,
      status: "accumulating",
      accumulatedText: input.text,
      messageIds: [input.messageId],
      lastMessageAt: input.receivedAt.toISOString(),
      processAfter: input.processAfter.toISOString(),
      metadata: {}
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
      throw new Error("Batch not found");
    }
    batch.status = "ready";
    return batch;
  }

  async markProcessed(id: string, metadata: Record<string, unknown> = {}): Promise<MessageBatchRecord> {
    const batch = this.batches.find((item) => item.id === id);
    if (!batch) {
      throw new Error("Batch not found");
    }
    batch.status = "processed";
    batch.metadata = { ...batch.metadata, ...metadata };
    return batch;
  }

  async markFailed(id: string, metadata: Record<string, unknown> = {}): Promise<MessageBatchRecord> {
    const batch = this.batches.find((item) => item.id === id);
    if (!batch) {
      throw new Error("Batch not found");
    }
    batch.status = "failed";
    batch.metadata = { ...batch.metadata, ...metadata };
    return batch;
  }
}

function createProcessorTestServices() {
  const patientsRepository = new FakePatientsRepository();
  const messagesRepository = new FakeMessagesRepository();
  const auditLogsRepository = new FakeAuditLogsRepository();
  const messageBatchesRepository = new FakeMessageBatchesRepository();
  const auditLogService = new AuditLogService(auditLogsRepository);
  const zapiCalls: unknown[] = [];
  const processor = new ConversationProcessorService(
    messageBatchesRepository,
    patientsRepository,
    messagesRepository,
    { parse: async () => agendaOutput },
    { respond: async () => marianaOutput },
    auditLogService,
    { sendWhatsappEnabled: false },
    { sendMessage: async (input) => {
      zapiCalls.push(input);
      return { id: "zapi-1", mocked: true };
    } }
  );

  return {
    patientsRepository,
    messagesRepository,
    auditLogsRepository,
    messageBatchesRepository,
    processor,
    zapiCalls
  };
}

describe("ConversationProcessorService", () => {
  it("processes a ready batch, calls agents and saves outbound draft", async () => {
    const services = createProcessorTestServices();

    const result = await services.processor.processReadyBatches();

    expect(result.processed).toEqual([
      {
        batchId: "batch-1",
        phone: "5561996531507",
        outboundMessageId: "outbound-1",
        status: "processed",
        sendWhatsappEnabled: false
      }
    ]);
    expect(services.messagesRepository.outboundDrafts).toHaveLength(1);
    expect(services.messagesRepository.outboundDrafts[0]).toMatchObject({
      text: "Claro, posso te ajudar a organizar a consulta.",
      metadata: {
        draft: true,
        sent: false,
        send_whatsapp_enabled: false
      }
    });
    expect(services.messageBatchesRepository.batches[0].status).toBe("processed");
  });

  it("does not call Z-API when SEND_WHATSAPP_ENABLED is false", async () => {
    const services = createProcessorTestServices();

    await services.processor.processReadyBatches();

    expect(services.zapiCalls).toHaveLength(0);
  });

  it("marks a batch as failed when processing throws", async () => {
    const services = createProcessorTestServices();
    const failingProcessor = new ConversationProcessorService(
      services.messageBatchesRepository,
      services.patientsRepository,
      services.messagesRepository,
      { parse: async () => {
        throw new Error("invalid_json_schema");
      } },
      { respond: async () => marianaOutput },
      new AuditLogService(services.auditLogsRepository),
      { sendWhatsappEnabled: false }
    );

    const result = await failingProcessor.processReadyBatches();

    expect(result.processed).toEqual([
      {
        batchId: "batch-1",
        phone: "5561996531507",
        status: "failed",
        sendWhatsappEnabled: false,
        error: "invalid_json_schema"
      }
    ]);
    expect(services.messageBatchesRepository.batches[0]).toMatchObject({
      status: "failed",
      metadata: {
        error: {
          message: "invalid_json_schema"
        }
      }
    });
    expect(services.auditLogsRepository.logs.map((log) => log.event)).toContain(
      "batch_processing_failed"
    );
  });

  it("worker marks due batches ready and then processes them", async () => {
    const services = createProcessorTestServices();
    services.messageBatchesRepository.batches[0].status = "accumulating";
    services.messageBatchesRepository.batches[0].processAfter = new Date(Date.now() - 1).toISOString();
    const debounceService = new MessageDebounceService(
      services.messageBatchesRepository,
      new AuditLogService(services.auditLogsRepository),
      { windowMs: 1 }
    );
    const worker = new MessageBatchWorkerService(debounceService, services.processor, 10);

    await worker.tick();

    expect(services.messageBatchesRepository.batches[0].status).toBe("processed");
    expect(services.messagesRepository.outboundDrafts).toHaveLength(1);
  });

  it("POST /internal/batches/process-ready processes ready batches in test", async () => {
    const services = createProcessorTestServices();
    const app = buildApp({
      dependencies: {
        conversationProcessorService: services.processor
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/batches/process-ready"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      processed: [
        {
          batchId: "batch-1",
          outboundMessageId: "outbound-1"
        }
      ]
    });

    await app.close();
  });
});
