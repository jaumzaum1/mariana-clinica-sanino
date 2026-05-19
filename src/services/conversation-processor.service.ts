import type { AgendaParserOutput } from "../schemas/agenda.schema.js";
import type { MarianaResponseOutput } from "../schemas/mariana.schema.js";
import type {
  MessageBatchesRepository,
  MessagesRepository,
  PatientRecord,
  PatientsRepository
} from "../repositories/types.js";
import type { AgendaParserAgent } from "../agents/agenda-parser.agent.js";
import type { MarianaAgent } from "../agents/mariana.agent.js";
import type { AuditLogService } from "./audit-log.service.js";
import type { AvailabilityResult, SchedulingService } from "./scheduling.service.js";
import type { CalendarSlot } from "./calendar.service.js";
import type { ZapiService } from "./zapi.service.js";
import { generateBrazilWhatsappVariants, normalizeBrazilPhone } from "../utils/phone.js";

export interface ConversationProcessorOptions {
  sendWhatsappEnabled: boolean;
}

export interface ProcessedBatchSummary {
  batchId: string;
  phone: string;
  outboundMessageId?: string;
  status: "processed" | "failed";
  sendWhatsappEnabled: false;
  error?: string;
}

export interface ProcessReadyBatchesResult {
  processed: ProcessedBatchSummary[];
}

export interface OfferedSlot extends CalendarSlot {
  index: number;
  label: string;
  source: "calendar";
}

export interface ConversationMemory {
  phone: string;
  current_status: string;
  memory_summary?: string | null;
  last_offered_slots: OfferedSlot[];
  selected_slot?: CalendarSlot | null;
  pending_registration_fields: string[];
  name?: string | null;
  cpf?: string | null;
  birth_date?: string | null;
  ai_paused: boolean;
  needs_doctor: boolean;
  last_intent?: string | null;
  last_updated_at: string;
  appointment_id?: string;
  calendar_event_id?: string;
}

export interface ProcessConversationMessageResult {
  batchId: string;
  phone: string;
  status: "processed" | "failed";
  outboundMessageId?: string;
  outboundMessage?: string;
  memory?: ConversationMemory;
  appointmentId?: string;
  calendarEventId?: string;
  selectedSlot?: CalendarSlot;
  error?: string;
}

export interface SimulateConversationResult {
  steps: ProcessConversationMessageResult[];
  finalStatus?: string;
  appointmentId?: string;
  calendarEventId?: string;
  outboundMessages: string[];
}

export class ConversationProcessorService {
  constructor(
    private readonly messageBatchesRepository: MessageBatchesRepository,
    private readonly patientsRepository: PatientsRepository,
    private readonly messagesRepository: MessagesRepository,
    private readonly agendaParserAgent: Pick<AgendaParserAgent, "parse">,
    private readonly marianaAgent: Pick<MarianaAgent, "respond">,
    private readonly auditLogService: AuditLogService,
    private readonly options: ConversationProcessorOptions,
    private readonly zapiService?: Pick<ZapiService, "sendMessage">,
    private readonly schedulingService?: SchedulingService
  ) {}

  async processReadyBatches(limit = 25): Promise<ProcessReadyBatchesResult> {
    const readyBatches = await this.messageBatchesRepository.findReady(limit);
    const processed: ProcessedBatchSummary[] = [];

    for (const batch of readyBatches) {
      processed.push(await this.processBatchSafely(batch.id, batch.phone, batch.accumulatedText));
    }

    return { processed };
  }

  async processConversationMessage(
    phoneInput: string,
    message: string,
    batchId = `conversation-${Date.now()}`
  ): Promise<ProcessConversationMessageResult> {
    const phone = normalizeBrazilPhone(phoneInput);
    const patient = await this.ensurePatient(phone);
    await this.messagesRepository.saveInbound({
      patientId: patient.id,
      phone,
      text: message,
      rawPayload: {
        source: "internal_conversation_simulate",
        batch_id: batchId
      },
      messageType: "text",
      receivedAt: new Date()
    });

    return this.processConversationTurn(batchId, phone, message);
  }

  async simulateConversation(phone: string, messages: string[]): Promise<SimulateConversationResult> {
    const steps: ProcessConversationMessageResult[] = [];

    for (const [index, message] of messages.entries()) {
      steps.push(await this.processConversationMessage(phone, message, `simulate-${index + 1}`));
    }

    const last = steps[steps.length - 1];
    return {
      steps,
      finalStatus: last?.memory?.current_status,
      appointmentId: last?.appointmentId ?? last?.memory?.appointment_id,
      calendarEventId: last?.calendarEventId ?? last?.memory?.calendar_event_id,
      outboundMessages: steps.flatMap((step) => step.outboundMessage ? [step.outboundMessage] : [])
    };
  }

  private async processBatchSafely(
    batchId: string,
    phone: string,
    accumulatedText: string
  ): Promise<ProcessedBatchSummary> {
    try {
      return await this.processBatch(batchId, phone, accumulatedText);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao processar batch.";

      await this.messageBatchesRepository.markFailed(batchId, {
        error: {
          message,
          name: error instanceof Error ? error.name : "UnknownError"
        },
        failed_at: new Date().toISOString()
      });

      await this.auditLogService.create({
        event: "batch_processing_failed",
        phone,
        metadata: {
          batchId,
          error: message
        }
      });
      await this.auditLogService.create({
        event: "conversation_batch_processing_failed",
        phone,
        metadata: {
          batchId,
          error: message
        }
      });

      return {
        batchId,
        phone,
        status: "failed",
        sendWhatsappEnabled: false,
        error: message
      };
    }
  }

  private async processBatch(
    batchId: string,
    phone: string,
    accumulatedText: string
  ): Promise<ProcessedBatchSummary> {
    const startedAt = Date.now();
    const result = await this.processConversationTurn(batchId, phone, accumulatedText);
    await this.messageBatchesRepository.markProcessed(batchId, {
      conversation: result,
      outbound_message_id: result.outboundMessageId,
      duration_ms: Date.now() - startedAt
    });

    await this.auditLogService.create({
      event: "batch_processed",
      phone,
      metadata: {
        batchId,
        outboundMessageId: result.outboundMessageId,
        durationMs: Date.now() - startedAt,
        sendWhatsappEnabled: false
      }
    });

    if (this.options.sendWhatsappEnabled) {
      await this.auditLogService.create({
        event: "whatsapp_send_skipped",
        phone,
        metadata: {
          batchId,
          reason: "Envio real desabilitado nesta etapa."
        }
      });
      void this.zapiService;
    }

    return {
      batchId,
      phone,
      outboundMessageId: result.outboundMessageId,
      status: "processed",
      sendWhatsappEnabled: false
    };
  }

  private async processConversationTurn(
    batchId: string,
    phone: string,
    accumulatedText: string
  ): Promise<ProcessConversationMessageResult> {
    const startedAt = Date.now();

    await this.auditLogService.create({
      event: "batch_processing_started",
      phone,
      metadata: { batchId }
    });
    await this.auditLogService.create({
      event: "conversation_batch_processing_started",
      phone,
      metadata: { batchId }
    });

    const patient = await this.ensurePatient(phone);
    const currentMemory = this.readConversationMemory(patient, phone);
    const agenda = await this.agendaParserAgent.parse(accumulatedText);
    const registrationData = this.mergeRegistrationData(currentMemory, agenda, accumulatedText);
    const selectedSlot =
      this.resolveSelectedSlot(accumulatedText, currentMemory.last_offered_slots) ??
      currentMemory.selected_slot ??
      this.extractSelectedSlotFromAgenda(agenda);

    let availability: AvailabilityResult | undefined;
    let offeredSlots: OfferedSlot[] = [];
    let appointment:
      | Awaited<ReturnType<SchedulingService["createAppointmentIfReady"]>>
      | undefined;
    let memory: ConversationMemory = {
      ...currentMemory,
      name: registrationData.name,
      cpf: registrationData.cpf,
      birth_date: registrationData.birth_date,
      selected_slot: selectedSlot,
      last_intent: agenda.intent,
      last_updated_at: new Date().toISOString()
    };

    await this.auditLogService.create({
      event: "agenda_parser_completed",
      phone,
      metadata: {
        batchId,
        intent: agenda.intent,
        schedulingAction: agenda.scheduling_action,
        needsDoctor: agenda.needs_doctor,
        shouldPauseAi: agenda.should_pause_ai
      }
    });

    if (this.requiresDoctor(accumulatedText, agenda, availability)) {
      memory = {
        ...memory,
        current_status: "aguardando_dr_joao",
        needs_doctor: true,
        ai_paused: true,
        pending_registration_fields: []
      };
      await this.auditLogService.create({
        event: "conversation_handoff_required",
        phone,
        metadata: { batchId, reason: "needs_doctor_or_saturday" }
      });
    } else if (
      (this.shouldUseScheduling(agenda) || Boolean(selectedSlot) || currentMemory.current_status === "aguardando_cadastro") &&
      this.schedulingService
    ) {
      if (selectedSlot) {
        await this.auditLogService.create({
          event: "conversation_slot_selected",
          phone,
          metadata: { batchId, selectedSlot, source: "last_offered_slots" }
        });
      }

      const missingFields = this.getMissingRegistrationFields(registrationData);
      if (!selectedSlot) {
        await this.auditLogService.create({
          event: "conversation_slots_requested",
          phone,
          metadata: {
            batchId,
            preferences: agenda.appointment_preferences
          }
        });

        availability = await this.schedulingService.getAvailableSlots({
          preferences: {
            dates: agenda.appointment_preferences.dates,
            periods: agenda.appointment_preferences.periods,
            rawText: accumulatedText
          },
          durationMinutes: 90
        });
        offeredSlots = this.buildOfferedSlots(availability.slots);
        memory = {
          ...memory,
          current_status: availability.blockedReason === "saturday_requires_doctor"
            ? "aguardando_dr_joao"
            : "horarios_oferecidos",
          last_offered_slots: offeredSlots,
          needs_doctor: availability.blockedReason === "saturday_requires_doctor",
          ai_paused: availability.blockedReason === "saturday_requires_doctor",
          pending_registration_fields: missingFields
        };

        await this.auditLogService.create({
          event: availability.blockedReason === "saturday_requires_doctor"
            ? "conversation_handoff_required"
            : "conversation_slots_offered",
          phone,
          metadata: {
            batchId,
            offeredSlots,
            blockedReason: availability.blockedReason
          }
        });
      } else if (missingFields.length > 0) {
        memory = {
          ...memory,
          current_status: "aguardando_cadastro",
          pending_registration_fields: missingFields
        };
        await this.auditLogService.create({
          event: "conversation_registration_missing",
          phone,
          metadata: { batchId, missingFields, selectedSlot }
        });
      } else {
        await this.auditLogService.create({
          event: "conversation_registration_completed",
          phone,
          metadata: {
            batchId,
            name: registrationData.name,
            cpf: registrationData.cpf,
            birthDate: registrationData.birth_date
          }
        });
        await this.auditLogService.create({
          event: "conversation_appointment_create_attempt",
          phone,
          metadata: { batchId, selectedSlot }
        });

        appointment = await this.schedulingService.createAppointmentIfReady({
          patient,
          registrationData: {
            name: registrationData.name,
            cpf: registrationData.cpf,
            birth_date: registrationData.birth_date,
            insurance: agenda.registration_data.insurance
          },
          selectedSlot,
          parserOutput: {
            ...agenda,
            registration_data: {
              ...agenda.registration_data,
              name: registrationData.name,
              cpf: registrationData.cpf,
              birth_date: registrationData.birth_date
            }
          },
          auditContext: { source: "mariana", route: "conversation_processor" }
        });

        if (appointment.created) {
          memory = {
            ...memory,
            current_status: "consulta_agendada",
            selected_slot: appointment.selectedSlot ?? selectedSlot,
            pending_registration_fields: [],
            appointment_id: appointment.appointmentId,
            calendar_event_id: appointment.eventId
          };
          await this.auditLogService.create({
            event: appointment.reused ? "conversation_appointment_reused" : "conversation_appointment_created",
            phone,
            metadata: {
              batchId,
              appointmentId: appointment.appointmentId,
              calendarEventId: appointment.eventId,
              selectedSlot: appointment.selectedSlot ?? selectedSlot
            }
          });
        } else {
          memory = {
            ...memory,
            current_status: appointment.needsDoctor ? "aguardando_dr_joao" : "horario_indisponivel",
            needs_doctor: Boolean(appointment.needsDoctor),
            ai_paused: Boolean(appointment.pauseAi),
            pending_registration_fields: []
          };
          if (appointment.needsDoctor) {
            await this.auditLogService.create({
              event: "conversation_handoff_required",
              phone,
              metadata: { batchId, reason: appointment.reason }
            });
          }
        }
      }
    }

    const savedPatient = await this.updateConversationMemory(patient, memory);
    const mariana = await this.marianaAgent.respond({
      phone,
      message: accumulatedText,
      agenda,
      patientMemory: memory.memory_summary ?? undefined,
      schedulingContext: {
        AVAILABLE_SLOTS: offeredSlots,
        LAST_OFFERED_SLOTS: memory.last_offered_slots,
        SELECTED_SLOT: memory.selected_slot,
        REGISTRATION_DATA: {
          name: memory.name,
          cpf: memory.cpf,
          birth_date: memory.birth_date
        },
        MISSING_REGISTRATION_FIELDS: memory.pending_registration_fields,
        EVENT_CREATED: appointment?.created ?? false,
        EVENT_ID: appointment?.eventId,
        APPOINTMENT_ID: appointment?.appointmentId,
        NEEDS_DOCTOR: memory.needs_doctor,
        AI_PAUSED: memory.ai_paused,
        BLOCKED_REASON: availability?.blockedReason ?? appointment?.reason
      }
    });

    const finalMemory: ConversationMemory = {
      ...this.readConversationMemory(savedPatient, phone),
      memory_summary: mariana.memory_summary ?? memory.memory_summary,
      ai_paused: memory.ai_paused || mariana.pause_ai,
      needs_doctor: memory.needs_doctor || mariana.needs_doctor,
      last_updated_at: new Date().toISOString()
    };
    await this.updateConversationMemory(savedPatient, finalMemory);
    if (mariana.memory_summary) {
      await this.patientsRepository.updateMemorySummary(savedPatient.id, mariana.memory_summary);
    }

    const outbound = await this.saveDraft(savedPatient.id, phone, batchId, agenda, mariana);

    await this.auditLogService.create({
      event: "conversation_response_draft_created",
      phone,
      metadata: {
        batchId,
        outboundMessageId: outbound.id,
        sendWhatsappEnabled: false
      }
    });
    await this.auditLogService.create({
      event: "conversation_batch_processing_completed",
      phone,
      metadata: {
        batchId,
        durationMs: Date.now() - startedAt,
        appointmentId: appointment?.appointmentId,
        calendarEventId: appointment?.eventId
      }
    });

    return {
      batchId,
      phone,
      status: "processed",
      outboundMessageId: outbound.id,
      outboundMessage: mariana.messages.join("\n\n"),
      memory: finalMemory,
      appointmentId: appointment?.appointmentId ?? finalMemory.appointment_id,
      calendarEventId: appointment?.eventId ?? finalMemory.calendar_event_id,
      selectedSlot: appointment?.selectedSlot ?? finalMemory.selected_slot ?? undefined
    };
  }

  private async saveDraft(
    patientId: string,
    phone: string,
    batchId: string,
    agenda: AgendaParserOutput,
    mariana: MarianaResponseOutput
  ) {
    const text = mariana.messages.join("\n\n");

    const outbound = await this.messagesRepository.saveOutboundDraft({
      patientId,
      phone,
      text,
      metadata: {
        draft: true,
        sent: false,
        send_whatsapp_enabled: this.options.sendWhatsappEnabled,
        send_status: this.options.sendWhatsappEnabled ? "pending" : "draft",
        batch_id: batchId,
        agenda_parser_output: agenda,
        mariana_response_output: mariana
      },
      sendStatus: this.options.sendWhatsappEnabled ? "pending" : "draft"
    });

    await this.auditLogService.create({
      event: "mariana_draft_saved",
      phone,
      metadata: {
        batchId,
        outboundMessageId: outbound.id,
        needsDoctor: mariana.needs_doctor,
        pauseAi: mariana.pause_ai
      }
    });

    return outbound;
  }

  private async ensurePatient(phone: string): Promise<PatientRecord> {
    const normalizedPhone = normalizeBrazilPhone(phone);
    const existing = await this.patientsRepository.findByPhone(normalizedPhone);
    if (existing) {
      return existing;
    }

    return this.patientsRepository.upsert({
      phone: normalizedPhone,
      phoneVariants: generateBrazilWhatsappVariants(normalizedPhone),
      metadata: {
        conversation_memory: this.createEmptyMemory(normalizedPhone)
      }
    });
  }

  private readConversationMemory(
    patient: PatientRecord,
    phone: string
  ): ConversationMemory {
    const raw = patient.metadata?.conversation_memory;
    const memory = raw && typeof raw === "object" ? raw as Partial<ConversationMemory> : {};
    const metadata = patient.metadata ?? {};

    return {
      phone,
      current_status: memory.current_status ?? "novo",
      memory_summary: memory.memory_summary ?? (
        typeof metadata.memory_summary === "string" ? metadata.memory_summary : null
      ),
      last_offered_slots: Array.isArray(memory.last_offered_slots)
        ? memory.last_offered_slots.filter(isOfferedSlot)
        : [],
      selected_slot: isCalendarSlot(memory.selected_slot) ? memory.selected_slot : null,
      pending_registration_fields: Array.isArray(memory.pending_registration_fields)
        ? memory.pending_registration_fields.filter((item): item is string => typeof item === "string")
        : [],
      name: memory.name ?? patient.name ?? null,
      cpf: memory.cpf ?? (typeof metadata.cpf === "string" ? metadata.cpf : null),
      birth_date: memory.birth_date ?? (typeof metadata.birth_date === "string" ? metadata.birth_date : null),
      ai_paused: Boolean(memory.ai_paused),
      needs_doctor: Boolean(memory.needs_doctor),
      last_intent: memory.last_intent ?? null,
      last_updated_at: memory.last_updated_at ?? new Date().toISOString(),
      appointment_id: memory.appointment_id,
      calendar_event_id: memory.calendar_event_id
    };
  }

  private createEmptyMemory(phone: string): ConversationMemory {
    return {
      phone,
      current_status: "novo",
      memory_summary: null,
      last_offered_slots: [],
      selected_slot: null,
      pending_registration_fields: [],
      name: null,
      cpf: null,
      birth_date: null,
      ai_paused: false,
      needs_doctor: false,
      last_intent: null,
      last_updated_at: new Date().toISOString()
    };
  }

  private async updateConversationMemory(
    patient: PatientRecord,
    memory: ConversationMemory
  ) {
    return this.patientsRepository.upsert({
      phone: patient.phone,
      name: memory.name ?? patient.name ?? undefined,
      phoneVariants: generateBrazilWhatsappVariants(patient.phone),
      metadata: {
        ...(patient.metadata ?? {}),
        cpf: memory.cpf,
        birth_date: memory.birth_date,
        memory_summary: memory.memory_summary,
        conversation_memory: memory
      }
    });
  }

  private mergeRegistrationData(
    memory: ConversationMemory,
    agenda: AgendaParserOutput,
    rawText: string
  ): { name: string | null; cpf: string | null; birth_date: string | null } {
    const extracted = extractRegistrationFromText(rawText);
    return {
      name: agenda.registration_data.name ?? extracted.name ?? memory.name ?? null,
      cpf: normalizeCpf(agenda.registration_data.cpf ?? extracted.cpf ?? memory.cpf ?? null),
      birth_date: agenda.registration_data.birth_date ?? extracted.birth_date ?? memory.birth_date ?? null
    };
  }

  private getMissingRegistrationFields(registrationData: {
    name: string | null;
    cpf: string | null;
    birth_date: string | null;
  }): string[] {
    const missing: string[] = [];
    if (!registrationData.name) missing.push("name");
    if (!registrationData.cpf) missing.push("cpf");
    if (!registrationData.birth_date) missing.push("birthDate");
    return missing;
  }

  private buildOfferedSlots(slots: CalendarSlot[]): OfferedSlot[] {
    return slots.map((slot, index) => ({
      ...slot,
      index: index + 1,
      label: formatSlotLabel(slot.start),
      source: "calendar"
    }));
  }

  private resolveSelectedSlot(message: string, offeredSlots: OfferedSlot[]): CalendarSlot | null {
    if (offeredSlots.length === 0) {
      return null;
    }

    const normalized = normalizeText(message);
    const ordinalIndex = resolveOrdinalIndex(normalized);
    if (ordinalIndex !== null) {
      return offeredSlots.find((slot) => slot.index === ordinalIndex) ?? null;
    }

    const exactTime = extractTimeFromMessage(normalized);
    if (exactTime) {
      return offeredSlots.find((slot) => formatLocalTime(slot.start) === exactTime) ?? null;
    }

    if (/(\besse\b|\bessa\b|pode ser)/i.test(normalized) && offeredSlots.length === 1) {
      return offeredSlots[0];
    }

    return null;
  }

  private extractSelectedSlotFromAgenda(agenda: AgendaParserOutput): CalendarSlot | null {
    const exact = agenda.appointment_preferences.dates.find((date) => /\d{4}-\d{2}-\d{2}T/.test(date));
    if (!exact) {
      return null;
    }

    const start = new Date(exact);
    if (Number.isNaN(start.getTime())) {
      return null;
    }

    return {
      start: start.toISOString(),
      end: new Date(start.getTime() + 90 * 60_000).toISOString()
    };
  }

  private requiresDoctor(
    message: string,
    agenda: AgendaParserOutput,
    availability?: AvailabilityResult
  ): boolean {
    const normalized = normalizeText(message);
    return (
      agenda.needs_doctor ||
      agenda.should_pause_ai ||
      normalized.includes("sabado") ||
      availability?.blockedReason === "saturday_requires_doctor"
    );
  }

  private shouldUseScheduling(agenda: AgendaParserOutput): boolean {
    return ["schedule", "reschedule"].includes(agenda.intent) || agenda.scheduling_action !== "none";
  }
}

function isCalendarSlot(value: unknown): value is CalendarSlot {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as CalendarSlot).start === "string" &&
    typeof (value as CalendarSlot).end === "string"
  );
}

function isOfferedSlot(value: unknown): value is OfferedSlot {
  return isCalendarSlot(value) &&
    typeof (value as OfferedSlot).index === "number" &&
    typeof (value as OfferedSlot).label === "string";
}

function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function resolveOrdinalIndex(normalizedMessage: string): number | null {
  if (/\b(1|primeiro|primeira)\b/.test(normalizedMessage)) return 1;
  if (/\b(2|segundo|segunda)\b/.test(normalizedMessage)) return 2;
  if (/\b(3|terceiro|terceira)\b/.test(normalizedMessage)) return 3;
  return null;
}

function extractTimeFromMessage(normalizedMessage: string): string | null {
  const match = normalizedMessage.match(/\b([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?\b/);
  if (!match) {
    return null;
  }

  const hour = match[1].padStart(2, "0");
  const minute = (match[2] ?? "00").padStart(2, "0");
  return `${hour}:${minute}`;
}

function formatLocalTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(iso));
}

function formatSlotLabel(iso: string): string {
  const date = new Date(iso);
  const weekday = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long"
  }).format(date);
  const dayMonth = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit"
  }).format(date);

  return `${weekday}, ${dayMonth}, às ${formatLocalTime(iso)}`;
}

function extractRegistrationFromText(text: string): {
  name: string | null;
  cpf: string | null;
  birth_date: string | null;
} {
  const cpf = text.match(/\bcpf\s*[:\-]?\s*([\d.\-]{11,14})/i)?.[1] ?? null;
  const birthDate =
    text.match(/\b(?:nasci(?:mento)?|nascido(?:a)? em|data de nascimento)\s*(?:em|:)?\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] ??
    text.match(/\b(\d{2}\/\d{2}\/\d{4})\b/)?.[1] ??
    null;
  const nameBeforeCpf = text.match(/^\s*([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+)+)\s*,?\s*cpf\b/i)?.[1];

  return {
    name: nameBeforeCpf?.trim() ?? null,
    cpf: normalizeCpf(cpf),
    birth_date: birthDate
  };
}

function normalizeCpf(cpf: string | null): string | null {
  if (!cpf) {
    return null;
  }

  const digits = cpf.replace(/\D/g, "");
  return digits.length === 11 ? digits : cpf;
}
