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
  OutboundDraftMessageRecord,
  AppointmentRecord,
  AppointmentsRepository,
  PatientRecord,
  PatientsRepository,
  SaveAppointmentInput,
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
import type { MarianaAgentInput } from "../agents/mariana.agent.js";
import type { CalendarAppointmentInput, CalendarSlot } from "../services/calendar.service.js";
import { SchedulingService, type CreateAppointmentIfReadyInput } from "../services/scheduling.service.js";

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
    const existing = await this.findByPhone(input.phone);
    const patient = existing ?? {
      id: `patient-${this.patients.length + 1}`,
      phone: input.phone,
      metadata: {}
    };
    patient.name = input.name ?? patient.name;
    patient.metadata = {
      ...(patient.metadata ?? {}),
      whatsapp_variants: input.phoneVariants,
      ...(input.metadata ?? {})
    };
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

  async findPendingOutboundForSend(): Promise<OutboundDraftMessageRecord[]> {
    return this.outboundDrafts.map((message) => ({
      ...message,
      rawPayload: { mariana: message.metadata },
      sendStatus: message.metadata.sent ? "sent" : "draft",
      sentAt: null,
      providerMessageId: null,
      sendError: null
    }));
  }

  async markOutboundSending(
    messageId: string,
    lockId: string
  ): Promise<OutboundDraftMessageRecord | null> {
    const message = this.outboundDrafts.find((item) => item.id === messageId);
    if (!message || message.metadata.sent) {
      return null;
    }

    return {
      ...message,
      rawPayload: { mariana: message.metadata },
      sendStatus: "sending",
      sentAt: null,
      providerMessageId: null,
      sendError: null,
      lockId
    };
  }

  async queueLatestOutboundDraft(): Promise<OutboundDraftMessageRecord | null> {
    return null;
  }

  async markOutboundSkipped(messageId: string): Promise<MessageRecord> {
    return this.outboundDrafts.find((message) => message.id === messageId) ?? this.outboundDrafts[0];
  }

  async markOutboundSent(messageId: string): Promise<MessageRecord> {
    return this.outboundDrafts.find((message) => message.id === messageId) ?? this.outboundDrafts[0];
  }

  async markOutboundSendFailed(messageId: string): Promise<MessageRecord> {
    return this.outboundDrafts.find((message) => message.id === messageId) ?? this.outboundDrafts[0];
  }
}

class FakeCalendarService {
  createdEvents: CalendarAppointmentInput[] = [];
  busySlots: CalendarSlot[] = [];

  constructor(private readonly availableBusySlots: CalendarSlot[] = []) {}

  async findBusySlots(input?: { start: string; end: string }): Promise<CalendarSlot[]> {
    if (!input) {
      return this.availableBusySlots;
    }

    return [...this.availableBusySlots, ...this.busySlots].filter((slot) =>
      new Date(slot.start) < new Date(input.end) && new Date(slot.end) > new Date(input.start)
    );
  }

  async createEvent(input: CalendarAppointmentInput): Promise<{ id: string; start: string; end: string }> {
    this.createdEvents.push(input);
    return {
      id: `event-${this.createdEvents.length}`,
      start: input.start,
      end: input.end
    };
  }

  async getEvent(id: string) {
    return {
      id,
      start: this.createdEvents[0]?.start ?? new Date(2026, 4, 19, 15, 30).toISOString(),
      end: this.createdEvents[0]?.end ?? new Date(2026, 4, 19, 17, 0).toISOString(),
      status: "confirmed",
      summary: this.createdEvents[0]?.summary,
      description: this.createdEvents[0]?.description,
      location: this.createdEvents[0]?.location,
      extendedProperties: {}
    };
  }

  async updateEventMetadata(): Promise<void> {}
}

class FakeAppointmentsRepository implements AppointmentsRepository {
  appointments: AppointmentRecord[] = [];

  async create(input: SaveAppointmentInput): Promise<AppointmentRecord> {
    const appointment: AppointmentRecord = {
      id: `appointment-${this.appointments.length + 1}`,
      patientId: input.patientId,
      phone: input.phone,
      calendarEventId: input.calendarEventId,
      status: input.status,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      metadata: input.metadata
    };
    this.appointments.push(appointment);
    return appointment;
  }

  async findScheduledByPatientSlot(input: {
    patientId: string;
    startsAt: string;
    endsAt: string;
  }): Promise<AppointmentRecord | null> {
    return this.appointments.find((appointment) =>
      appointment.patientId === input.patientId &&
      appointment.startsAt === input.startsAt &&
      appointment.endsAt === input.endsAt &&
      appointment.status === "scheduled"
    ) ?? null;
  }

  async updateCalendarEventId(input: {
    appointmentId: string;
    calendarEventId: string;
    metadata?: Record<string, unknown>;
  }): Promise<AppointmentRecord> {
    const appointment = this.appointments.find((item) => item.id === input.appointmentId);
    if (!appointment) {
      throw new Error("Appointment not found");
    }
    appointment.calendarEventId = input.calendarEventId;
    appointment.metadata = { ...(appointment.metadata ?? {}), ...(input.metadata ?? {}) };
    return appointment;
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
      return { provider: "zapi", messageId: "zapi-1" };
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

function createConversationFlowServices(options: {
  createResult?: { created: boolean; reason?: string; needsDoctor?: boolean; pauseAi?: boolean };
} = {}) {
  const patientsRepository = new FakePatientsRepository();
  const messagesRepository = new FakeMessagesRepository();
  const auditLogsRepository = new FakeAuditLogsRepository();
  const messageBatchesRepository = new FakeMessageBatchesRepository();
  const auditLogService = new AuditLogService(auditLogsRepository);
  const calendar = new FakeCalendarService();
  const slot1 = {
    start: "2026-05-20T17:00:00.000Z",
    end: "2026-05-20T18:30:00.000Z"
  };
  const slot2 = {
    start: "2026-05-20T18:30:00.000Z",
    end: "2026-05-20T20:00:00.000Z"
  };
  const slot3 = {
    start: "2026-05-20T21:00:00.000Z",
    end: "2026-05-20T22:30:00.000Z"
  };
  const appointments = new Map<string, {
    appointmentId: string;
    eventId: string;
    slot: CalendarSlot;
  }>();
  let appointmentCount = 0;

  const parse = async (message: string): Promise<AgendaParserOutput> => {
    const lower = message.toLowerCase();
    const isSaturday = lower.includes("sábado") || lower.includes("sabado");
    const hasRegistration = lower.includes("cpf") || lower.includes("nasci");
    return {
      ...agendaOutput,
      intent: hasRegistration ? "registration" : "schedule",
      scheduling_action: hasRegistration ? "none" : "collect_preferences",
      needs_doctor: isSaturday,
      should_pause_ai: isSaturday,
      appointment_preferences: {
        ...agendaOutput.appointment_preferences,
        periods: lower.includes("tarde") ? ["afternoon"] : [],
        dates: [],
        reason: "Consulta"
      },
      registration_data: hasRegistration
        ? {
            name: lower.includes("joão") || lower.includes("joao") ? "João Maldonado" : null,
            cpf: lower.includes("cpf") ? "12345678900" : null,
            birth_date: lower.includes("14/05/1990") ? "14/05/1990" : null,
            insurance: null
          }
        : agendaOutput.registration_data,
      raw_summary: message
    };
  };

  const marianaMessages: string[] = [];
  const processor = new ConversationProcessorService(
    messageBatchesRepository,
    patientsRepository,
    messagesRepository,
    { parse },
    {
      respond: async (input: MarianaAgentInput): Promise<MarianaResponseOutput> => {
        const scheduling = input.schedulingContext as {
          AVAILABLE_SLOTS?: Array<{ label: string }>;
          SELECTED_SLOT?: CalendarSlot | null;
          MISSING_REGISTRATION_FIELDS?: string[];
          EVENT_CREATED?: boolean;
          NEEDS_DOCTOR?: boolean;
          BLOCKED_REASON?: string;
        };
        let message = "Claro, posso te ajudar.";
        if (scheduling.NEEDS_DOCTOR) {
          message = "Vou verificar esse caso diretamente com o Dr. João e te retorno.";
        } else if (scheduling.EVENT_CREATED) {
          message = "Consulta confirmada. Te espero na Clínica Sanino - Rua dos Bancários, 529.";
        } else if (scheduling.SELECTED_SLOT && scheduling.MISSING_REGISTRATION_FIELDS?.length) {
          message = `Para confirmar, preciso de: ${scheduling.MISSING_REGISTRATION_FIELDS.join(", ")}.`;
        } else if (scheduling.BLOCKED_REASON === "Horario ocupado.") {
          message = "Esse horário ficou indisponível. Vou te passar outra opção.";
        } else if (scheduling.AVAILABLE_SLOTS?.length) {
          message = `Tenho estes horários: ${scheduling.AVAILABLE_SLOTS.map((slot) => slot.label).join("; ")}.`;
        }
        marianaMessages.push(message);
        return {
          ...marianaOutput,
          messages: [message],
          needs_doctor: Boolean(scheduling.NEEDS_DOCTOR),
          pause_ai: Boolean(scheduling.NEEDS_DOCTOR),
          memory_summary: "Fluxo de agendamento em andamento."
        };
      }
    },
    auditLogService,
    { sendWhatsappEnabled: false },
    undefined,
    {
      getAvailableSlots: async () => ({ slots: [slot1, slot2, slot3], alternatives: [slot1, slot2, slot3] }),
      createAppointmentIfReady: async (input: CreateAppointmentIfReadyInput) => {
        if (options.createResult && !options.createResult.created) {
          return {
            created: false,
            missingFields: [],
            reason: options.createResult.reason,
            needsDoctor: options.createResult.needsDoctor,
            pauseAi: options.createResult.pauseAi,
            selectedSlot: input.selectedSlot ?? undefined
          };
        }

        const selectedSlot = input.selectedSlot ?? slot2;
        const key = `${input.patient?.id}-${selectedSlot.start}-${selectedSlot.end}`;
        const existing = appointments.get(key);
        if (existing) {
          return {
            created: true,
            reused: true,
            appointmentId: existing.appointmentId,
            eventId: existing.eventId,
            patientId: input.patient?.id,
            missingFields: [],
            selectedSlot
          };
        }

        appointmentCount += 1;
        const event = await calendar.createEvent({
          patientName: input.registrationData.name ?? "Paciente",
          phone: input.patient?.phone ?? "5561996531507",
          start: selectedSlot.start,
          end: selectedSlot.end,
          summary: `Consulta - ${input.registrationData.name} - Dr. João Maldonado`,
          description: [
            `Paciente: ${input.registrationData.name}`,
            `Telefone: ${input.patient?.phone}`,
            `CPF: ${input.registrationData.cpf}`,
            `Data de nascimento: ${input.registrationData.birth_date}`,
            "Origem: Mariana",
            "Tipo: primeira_consulta",
            "Status: scheduled"
          ].join("\n"),
          location: "Clínica Sanino - Rua dos Bancários, 529 - Jardim Maria Izabel, Marília - SP",
          metadata: {
            source: "mariana",
            createdBySystem: true,
            phone: input.patient?.phone,
            cpf: input.registrationData.cpf,
            patientName: input.registrationData.name,
            patientId: input.patient?.id,
            appointmentId: `appointment-${appointmentCount}`,
            appointmentType: "primeira_consulta",
            status: "scheduled"
          }
        });
        const appointment = {
          appointmentId: `appointment-${appointmentCount}`,
          eventId: event.id,
          slot: selectedSlot
        };
        appointments.set(key, appointment);
        return {
          created: true,
          reused: false,
          appointmentId: appointment.appointmentId,
          eventId: appointment.eventId,
          patientId: input.patient?.id,
          missingFields: [],
          selectedSlot
        };
      }
    } as unknown as SchedulingService
  );

  return {
    patientsRepository,
    messagesRepository,
    auditLogsRepository,
    processor,
    calendar,
    marianaMessages,
    slots: [slot1, slot2, slot3],
    appointments
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

  it("passes AVAILABLE_SLOTS to Mariana when scheduling is relevant", async () => {
    const services = createProcessorTestServices();
    const availableSlot: CalendarSlot = {
      start: new Date(2026, 4, 19, 15, 30).toISOString(),
      end: new Date(2026, 4, 19, 17, 0).toISOString()
    };
    let capturedInput: MarianaAgentInput | undefined;
    const processor = new ConversationProcessorService(
      services.messageBatchesRepository,
      services.patientsRepository,
      services.messagesRepository,
      { parse: async () => agendaOutput },
      {
        respond: async (input) => {
          capturedInput = input;
          return marianaOutput;
        }
      },
      new AuditLogService(services.auditLogsRepository),
      { sendWhatsappEnabled: false },
      undefined,
      {
        getAvailableSlots: async () => ({ slots: [availableSlot], alternatives: [availableSlot] }),
        createAppointmentIfReady: async () => ({ created: false, missingFields: ["cpf"] })
      } as never
    );

    await processor.processReadyBatches();

    expect(capturedInput?.schedulingContext).toMatchObject({
      AVAILABLE_SLOTS: [
        {
          ...availableSlot,
          index: 1,
          source: "calendar"
        }
      ],
      EVENT_CREATED: false,
      MISSING_REGISTRATION_FIELDS: ["name", "cpf", "birthDate"]
    });
  });

  it("marks scheduling appointment created in batch metadata", async () => {
    const services = createProcessorTestServices();
    const slot = {
      start: new Date(2026, 4, 19, 15, 30).toISOString(),
      end: new Date(2026, 4, 19, 17, 0).toISOString()
    };
    const processor = new ConversationProcessorService(
      services.messageBatchesRepository,
      services.patientsRepository,
      services.messagesRepository,
      {
        parse: async () => ({
          ...agendaOutput,
          appointment_preferences: {
            ...agendaOutput.appointment_preferences,
            dates: [slot.start]
          },
          registration_data: {
            name: "João Maldonado",
            cpf: "12345678900",
            birth_date: "1990-05-14",
            insurance: null
          }
        })
      },
      { respond: async () => marianaOutput },
      new AuditLogService(services.auditLogsRepository),
      { sendWhatsappEnabled: false },
      undefined,
      {
        getAvailableSlots: async () => ({ slots: [slot], alternatives: [slot] }),
        createAppointmentIfReady: async () => ({
          created: true,
          eventId: "event-1",
          appointmentId: "appointment-1",
          missingFields: [],
          selectedSlot: slot
        })
      } as never
    );

    await processor.processReadyBatches();

    expect(services.messageBatchesRepository.batches[0].metadata).toMatchObject({
      conversation: {
        appointmentId: "appointment-1",
        calendarEventId: "event-1"
      }
    });
  });

  it("simulates multi-message scheduling, selects second slot and creates appointment", async () => {
    const services = createConversationFlowServices();

    const result = await services.processor.simulateConversation("5561996531507", [
      "Quero marcar terça-feira à tarde",
      "Pode ser o segundo",
      "João Maldonado, CPF 12345678900, nasci em 14/05/1990"
    ]);

    const patient = services.patientsRepository.patients[0];
    const memory = patient.metadata?.conversation_memory as Record<string, unknown>;

    expect(result.finalStatus).toBe("consulta_agendada");
    expect(result.appointmentId).toBe("appointment-1");
    expect(result.calendarEventId).toBe("event-1");
    expect(memory).toMatchObject({
      current_status: "consulta_agendada",
      selected_slot: services.slots[1],
      appointment_id: "appointment-1",
      calendar_event_id: "event-1",
      cpf: "12345678900"
    });
    expect((memory.last_offered_slots as unknown[])).toHaveLength(3);
    expect(services.calendar.createdEvents).toHaveLength(1);
    expect(services.calendar.createdEvents[0]).toMatchObject({
      summary: "Consulta - João Maldonado - Dr. João Maldonado",
      location: "Clínica Sanino - Rua dos Bancários, 529 - Jardim Maria Izabel, Marília - SP",
      metadata: {
        source: "mariana",
        createdBySystem: true,
        patientId: "patient-1",
        appointmentType: "primeira_consulta",
        status: "scheduled"
      }
    });
    expect(services.calendar.createdEvents[0].description).toContain("Paciente: João Maldonado");
    expect(result.outboundMessages.at(-1)).toContain("Consulta confirmada");
    expect(services.auditLogsRepository.logs.map((log) => log.event)).toEqual(
      expect.arrayContaining([
        "conversation_slots_requested",
        "conversation_slots_offered",
        "conversation_slot_selected",
        "conversation_registration_completed",
        "conversation_appointment_created",
        "conversation_response_draft_created",
        "conversation_batch_processing_completed"
      ])
    );
  });

  it("asks only missing registration fields after slot selection", async () => {
    const services = createConversationFlowServices();

    const result = await services.processor.simulateConversation("5561996531507", [
      "Quero marcar terça-feira à tarde",
      "Pode ser o segundo"
    ]);

    expect(result.finalStatus).toBe("aguardando_cadastro");
    expect(result.outboundMessages.at(-1)).toContain("name, cpf, birthDate");
    expect(services.calendar.createdEvents).toHaveLength(0);
  });

  it("marks Saturday requests as handoff and does not create events", async () => {
    const services = createConversationFlowServices();

    const result = await services.processor.simulateConversation("5561996531507", [
      "Quero marcar sábado à tarde"
    ]);

    expect(result.finalStatus).toBe("aguardando_dr_joao");
    expect(result.outboundMessages.at(-1)).toContain("Dr. João");
    expect(services.calendar.createdEvents).toHaveLength(0);
    expect(services.auditLogsRepository.logs.map((log) => log.event)).toContain("conversation_handoff_required");
  });

  it("does not create event when selected slot became busy", async () => {
    const services = createConversationFlowServices({
      createResult: { created: false, reason: "Horario ocupado." }
    });

    const result = await services.processor.simulateConversation("5561996531507", [
      "Quero marcar terça-feira à tarde",
      "Pode ser o segundo",
      "João Maldonado, CPF 12345678900, nasci em 14/05/1990"
    ]);

    expect(result.finalStatus).toBe("horario_indisponivel");
    expect(result.calendarEventId).toBeUndefined();
    expect(services.calendar.createdEvents).toHaveLength(0);
  });

  it("keeps last offered slots between messages and duplicate calls reuse appointment", async () => {
    const services = createConversationFlowServices();

    await services.processor.simulateConversation("5561996531507", [
      "Quero marcar terça-feira à tarde",
      "Pode ser o segundo",
      "João Maldonado, CPF 12345678900, nasci em 14/05/1990"
    ]);
    const duplicate = await services.processor.simulateConversation("5561996531507", [
      "Pode ser o segundo",
      "João Maldonado, CPF 12345678900, nasci em 14/05/1990"
    ]);
    const memory = services.patientsRepository.patients[0].metadata?.conversation_memory as Record<string, unknown>;

    expect((memory.last_offered_slots as unknown[])).toHaveLength(3);
    expect(duplicate.appointmentId).toBe("appointment-1");
    expect(duplicate.calendarEventId).toBe("event-1");
    expect(services.calendar.createdEvents).toHaveLength(1);
    expect(services.auditLogsRepository.logs.map((log) => log.event)).toContain("conversation_appointment_reused");
  });

  it("POST /internal/conversation/simulate returns steps and outbound messages", async () => {
    const services = createConversationFlowServices();
    const app = buildApp({
      dependencies: {
        conversationProcessorService: services.processor
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/internal/conversation/simulate",
      payload: {
        phone: "5561996531507",
        messages: [
          "Quero marcar terça-feira à tarde",
          "Pode ser o segundo",
          "João Maldonado, CPF 12345678900, nasci em 14/05/1990"
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      finalStatus: "consulta_agendada",
      appointmentId: "appointment-1",
      calendarEventId: "event-1"
    });
    expect(response.json().steps).toHaveLength(3);
    expect(response.json().outboundMessages.at(-1)).toContain("Consulta confirmada");

    await app.close();
  });
});
