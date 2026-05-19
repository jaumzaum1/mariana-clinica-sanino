import type { AgendaParserOutput } from "../schemas/agenda.schema.js";
import type {
  AppointmentsRepository,
  PatientRecord,
  PatientsRepository
} from "../repositories/types.js";
import type { CalendarService, CalendarSlot, CalendarEventDetails } from "./calendar.service.js";
import { CalendarEventNotFoundError, isEventAbsentForAgenda } from "./calendar.service.js";
import type { AuditLogService } from "./audit-log.service.js";
import { generateBrazilWhatsappVariants, normalizeBrazilPhone } from "../utils/phone.js";

export interface SchedulingDecision {
  status: "needs_more_info" | "ready_to_schedule" | "not_scheduling";
  reason: string;
}

export interface SchedulingPreferences {
  dates?: string[];
  periods?: Array<"morning" | "afternoon" | "evening" | "any">;
  selectedSlot?: CalendarSlot | null;
  requestedWeekday?: number | null;
  requestedExactTime?: string | null;
  rawText?: string;
}

export interface GetAvailableSlotsInput {
  preferences: SchedulingPreferences;
  durationMinutes?: number;
  now?: Date;
  limit?: number;
}

export interface AvailabilityResult {
  slots: CalendarSlot[];
  blockedReason?: "saturday_requires_doctor" | "closed_day";
  alternatives: CalendarSlot[];
}

export interface CreateAppointmentIfReadyInput {
  patient?: PatientRecord;
  phone?: string;
  registrationData: AgendaParserOutput["registration_data"];
  selectedSlot?: CalendarSlot | null;
  parserOutput: AgendaParserOutput;
  auditContext?: {
    route?: string;
    source?: string;
  };
}

export interface CreateAppointmentIfReadyResult {
  created: boolean;
  reused?: boolean;
  eventId?: string;
  appointmentId?: string;
  patientId?: string;
  summary?: string;
  missingFields: string[];
  needsDoctor?: boolean;
  pauseAi?: boolean;
  reason?: string;
  selectedSlot?: CalendarSlot;
}

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
const DEFAULT_DURATION_MINUTES = 90;
const SLOT_STEP_MINUTES = 30;
const CLINIC_START_HOUR = 9;
const CLINIC_END_HOUR = 19;

const CLINIC_LOCATION = "Clínica Sanino - Rua dos Bancários, 529 - Jardim Maria Izabel, Marília - SP";
const REQUIRED_EVENT_PRIVATE_KEYS = [
  "source",
  "createdBySystem",
  "phone",
  "cpf",
  "patientName",
  "patientId",
  "appointmentId",
  "appointmentType",
  "status"
] as const;

export class SchedulingService {
  constructor(
    private readonly calendarService: Pick<CalendarService, "findBusySlots" | "createEvent" | "getEvent"> &
      Partial<Pick<CalendarService, "updateEventMetadata" | "updateEvent">>,
    private readonly appointmentsRepository?: AppointmentsRepository,
    private readonly patientsRepository?: PatientsRepository,
    private readonly auditLogService?: AuditLogService
  ) {}

  async evaluateAgendaIntent(intent: { intent: string }): Promise<SchedulingDecision> {
    if (intent.intent === "none") {
      return { status: "not_scheduling", reason: "Mensagem nao contem intencao de agenda." };
    }

    const result = await this.getAvailableSlots({
      preferences: {},
      durationMinutes: DEFAULT_DURATION_MINUTES
    });

    if (result.slots.length === 0) {
      return { status: "needs_more_info", reason: "Agenda ainda nao conectada." };
    }

    return { status: "ready_to_schedule", reason: "Ha horarios candidatos disponiveis." };
  }

  async getAvailableSlots(input: GetAvailableSlotsInput): Promise<AvailabilityResult> {
    const now = input.now ?? new Date();
    const durationMinutes = input.durationMinutes ?? DEFAULT_DURATION_MINUTES;
    const earliestStart = new Date(now.getTime() + 24 * 60 * 60_000);
    const windowStart = startOfDay(earliestStart);
    const windowEnd = addDays(windowStart, 21);
    const busySlots = await this.calendarService.findBusySlots({
      start: windowStart.toISOString(),
      end: windowEnd.toISOString()
    });
    const requestedWeekday = resolveRequestedWeekday(input.preferences);
    const exactSlot = this.extractExactSlotFromPreferences(input.preferences, durationMinutes);

    if (exactSlot) {
      const weekday = new Date(exactSlot.start).getDay();
      if (weekday === 6) return { slots: [], alternatives: [], blockedReason: "saturday_requires_doctor" };
      if (weekday === 0 || weekday === 1) return { slots: [], alternatives: [], blockedReason: "closed_day" };

      if (!busySlots.some((busy) => overlaps(exactSlot, busy)) && new Date(exactSlot.start) >= earliestStart) {
        return { slots: [exactSlot], alternatives: [exactSlot] };
      }
    }
    const effectiveRequestedWeekday = exactSlot
      ? new Date(exactSlot.start).getDay()
      : requestedWeekday;

    if (effectiveRequestedWeekday === 6) {
      return { slots: [], alternatives: [], blockedReason: "saturday_requires_doctor" };
    }

    if (effectiveRequestedWeekday === 0 || effectiveRequestedWeekday === 1) {
      return { slots: [], alternatives: [], blockedReason: "closed_day" };
    }

    const allSlots = this.buildCandidateSlots({
      from: earliestStart,
      days: 21,
      durationMinutes,
      requestedWeekday: effectiveRequestedWeekday,
      preferences: input.preferences,
      busySlots
    });

    return {
      slots: allSlots.slice(0, input.limit ?? 3),
      alternatives: allSlots.slice(0, 6)
    };
  }

  async validateSlotStillFree(slot: CalendarSlot): Promise<boolean> {
    const busySlots = await this.calendarService.findBusySlots({
      start: slot.start,
      end: slot.end
    });

    return !busySlots.some((busy) => overlaps(slot, busy));
  }

  async createAppointmentIfReady(
    input: CreateAppointmentIfReadyInput
  ): Promise<CreateAppointmentIfReadyResult> {
    const selectedSlot = input.selectedSlot ?? this.extractSelectedSlot(input.parserOutput);
    const source = input.auditContext?.source ?? "mariana";
    const route = input.auditContext?.route;
    const phone = normalizeBrazilPhone(input.patient?.phone ?? input.phone ?? "");
    const patientName = input.registrationData.name ?? input.patient?.name ?? "Paciente";
    const summary = `Consulta - ${patientName} - Dr. João Maldonado`;

    const weekday = selectedSlot ? new Date(selectedSlot.start).getDay() : null;

    if (weekday === 6) {
      return {
        created: false,
        missingFields: [],
        needsDoctor: true,
        pauseAi: true,
        reason: "Sabado requer confirmacao do Dr. Joao.",
        selectedSlot: selectedSlot ?? undefined
      };
    }

    if (weekday === 0 || weekday === 1) {
      return {
        created: false,
        missingFields: [],
        reason: "Clinica fechada no dia solicitado.",
        selectedSlot: selectedSlot ?? undefined
      };
    }

    if (!selectedSlot) {
      return { created: false, missingFields: ["selectedSlot"] };
    }

    const missingFields = this.getMissingRegistrationFields(input.registrationData);
    if (missingFields.length > 0) {
      return {
        created: false,
        missingFields,
        selectedSlot
      };
    }

    const patient = await this.resolvePatientForAppointment(input, phone, source, route, selectedSlot, summary);
    const existingAppointment = await this.appointmentsRepository?.findScheduledByPatientSlot({
      patientId: patient.id,
      startsAt: selectedSlot.start,
      endsAt: selectedSlot.end
    });

    if (existingAppointment?.calendarEventId) {
      return this.reuseOrRecreateExistingAppointment({
        existingAppointment,
        patient,
        phone,
        patientName,
        summary,
        selectedSlot,
        registrationData: input.registrationData,
        parserOutput: input.parserOutput,
        source,
        route
      });
    }

    const slotIsFree = await this.validateSlotStillFree(selectedSlot);
    if (!slotIsFree) {
      return {
        created: false,
        missingFields: [],
        reason: "Horario ocupado.",
        selectedSlot
      };
    }

    await this.audit("calendar_event_create_attempt", phone, {
      patientId: patient.id,
      start: selectedSlot.start,
      end: selectedSlot.end,
      source,
      route,
      summary
    });

    let event: Awaited<ReturnType<CalendarService["createEvent"]>>;
    try {
      event = await this.createCalendarEvent({
        patient,
        phone,
        patientName,
        summary,
        selectedSlot,
        registrationData: input.registrationData,
        parserOutput: input.parserOutput
      });
    } catch (error) {
      await this.audit("calendar_event_failed", phone, {
        patientId: patient.id,
        start: selectedSlot.start,
        end: selectedSlot.end,
        source,
        route,
        summary,
        error: error instanceof Error ? error.message : "Erro desconhecido ao criar evento."
      });
      throw error;
    }

    await this.audit("calendar_event_created", phone, {
      patientId: patient.id,
      calendarEventId: event.id,
      start: selectedSlot.start,
      end: selectedSlot.end,
      source,
      route,
      summary
    });

    let appointment: Awaited<ReturnType<AppointmentsRepository["create"]>> | undefined;
    try {
      appointment = await this.appointmentsRepository?.create({
        patientId: patient.id,
        phone,
        calendarEventId: event.id,
        status: "scheduled",
        startsAt: selectedSlot.start,
        endsAt: selectedSlot.end,
        appointmentType: "primeira_consulta",
        source,
        notes: input.parserOutput.raw_summary,
        metadata: {
          parserOutput: input.parserOutput,
          patientId: patient.id,
          route,
          summary
        }
      });
    } catch (error) {
      await this.audit("appointment_save_failed", phone, {
        patientId: patient.id,
        calendarEventId: event.id,
        start: selectedSlot.start,
        end: selectedSlot.end,
        source,
        route,
        summary,
        error: error instanceof Error ? error.message : "Erro desconhecido ao salvar appointment."
      });
      throw error;
    }

    await this.audit("appointment_saved", phone, {
      patientId: patient.id,
      appointmentId: appointment?.id,
      calendarEventId: event.id,
      start: selectedSlot.start,
      end: selectedSlot.end,
      source,
      route,
      summary
    });

    if (appointment?.id && this.calendarService.updateEventMetadata) {
      await this.calendarService.updateEventMetadata(event.id, {
        appointmentId: appointment.id
      });
    }

    return {
      created: true,
      reused: false,
      eventId: event.id,
      appointmentId: appointment?.id,
      patientId: patient.id,
      summary,
      missingFields: [],
      selectedSlot
    };
  }

  private async reuseOrRecreateExistingAppointment(input: {
    existingAppointment: NonNullable<Awaited<ReturnType<AppointmentsRepository["findScheduledByPatientSlot"]>>>;
    patient: PatientRecord;
    phone: string;
    patientName: string;
    summary: string;
    selectedSlot: CalendarSlot;
    registrationData: AgendaParserOutput["registration_data"];
    parserOutput: AgendaParserOutput;
    source: string;
    route?: string;
  }): Promise<CreateAppointmentIfReadyResult> {
    const {
      existingAppointment,
      patient,
      phone,
      patientName,
      summary,
      selectedSlot,
      registrationData,
      parserOutput,
      source,
      route
    } = input;
    const oldCalendarEventId = existingAppointment.calendarEventId!;

    await this.audit("calendar_event_reuse_validation_started", phone, {
      phone,
      patientId: patient.id,
      appointmentId: existingAppointment.id,
      oldCalendarEventId,
      start: selectedSlot.start,
      end: selectedSlot.end,
      source,
      route
    });

    try {
      const calendarEvent = await this.calendarService.getEvent(oldCalendarEventId);

      if (!isEventAbsentForAgenda(calendarEvent)) {
        await this.ensureCalendarEventMetadata({
          calendarEvent: calendarEvent!,
          appointmentId: existingAppointment.id,
          patient,
          phone,
          patientName,
          summary,
          selectedSlot,
          registrationData,
          parserOutput,
          source,
          route
        });

        await this.audit("calendar_event_reuse_validated", phone, {
          phone,
          patientId: patient.id,
          appointmentId: existingAppointment.id,
          oldCalendarEventId,
          start: selectedSlot.start,
          end: selectedSlot.end,
          source,
          route
        });
        await this.audit("appointment_reused", phone, {
          phone,
          patientId: patient.id,
          appointmentId: existingAppointment.id,
          oldCalendarEventId,
          start: selectedSlot.start,
          end: selectedSlot.end,
          source,
          route
        });
        await this.audit("calendar_event_reused", phone, {
          phone,
          patientId: patient.id,
          appointmentId: existingAppointment.id,
          oldCalendarEventId,
          start: selectedSlot.start,
          end: selectedSlot.end,
          source,
          route
        });

        return {
          created: true,
          reused: true,
          eventId: oldCalendarEventId,
          appointmentId: existingAppointment.id,
          patientId: patient.id,
          summary,
          missingFields: [],
          selectedSlot
        };
      }

      return this.recreateMissingCalendarEvent({
        existingAppointment,
        patient,
        phone,
        patientName,
        summary,
        selectedSlot,
        registrationData,
        parserOutput,
        source,
        route,
        oldCalendarEventId,
        reason: calendarEvent?.status === "cancelled" ? "cancelled" : "missing"
      });
    } catch (error) {
      if (error instanceof CalendarEventNotFoundError) {
        return this.recreateMissingCalendarEvent({
          existingAppointment,
          patient,
          phone,
          patientName,
          summary,
          selectedSlot,
          registrationData,
          parserOutput,
          source,
          route,
          oldCalendarEventId,
          reason: "not_found"
        });
      }

      await this.audit("calendar_event_validation_failed", phone, {
        phone,
        patientId: patient.id,
        appointmentId: existingAppointment.id,
        oldCalendarEventId,
        start: selectedSlot.start,
        end: selectedSlot.end,
        source,
        route,
        error: error instanceof Error ? error.message : "Erro desconhecido ao validar evento."
      });
      throw error;
    }
  }

  private async recreateMissingCalendarEvent(input: {
    existingAppointment: NonNullable<Awaited<ReturnType<AppointmentsRepository["findScheduledByPatientSlot"]>>>;
    patient: PatientRecord;
    phone: string;
    patientName: string;
    summary: string;
    selectedSlot: CalendarSlot;
    registrationData: AgendaParserOutput["registration_data"];
    parserOutput: AgendaParserOutput;
    source: string;
    route?: string;
    oldCalendarEventId: string;
    reason: "missing" | "cancelled" | "not_found";
  }): Promise<CreateAppointmentIfReadyResult> {
    const {
      existingAppointment,
      patient,
      phone,
      patientName,
      summary,
      selectedSlot,
      registrationData,
      parserOutput,
      source,
      route,
      oldCalendarEventId,
      reason
    } = input;

    await this.audit("calendar_event_missing", phone, {
      phone,
      patientId: patient.id,
      appointmentId: existingAppointment.id,
      oldCalendarEventId,
      start: selectedSlot.start,
      end: selectedSlot.end,
      source,
      route,
      reason
    });

    const event = await this.createCalendarEvent({
      patient,
      phone,
      patientName,
      summary,
      selectedSlot,
      registrationData,
      parserOutput,
      appointmentId: existingAppointment.id
    });

    await this.audit("calendar_event_recreated", phone, {
      phone,
      patientId: patient.id,
      appointmentId: existingAppointment.id,
      oldCalendarEventId,
      newCalendarEventId: event.id,
      start: selectedSlot.start,
      end: selectedSlot.end,
      source,
      route,
      reason
    });

    if (!this.appointmentsRepository) {
      throw new Error("AppointmentsRepository is required to update calendar_event_id.");
    }

    await this.appointmentsRepository.updateCalendarEventId({
      appointmentId: existingAppointment.id,
      calendarEventId: event.id,
      metadata: {
        previous_calendar_event_id: oldCalendarEventId,
        calendar_event_recreated_reason: reason,
        route
      }
    });

    await this.audit("appointment_calendar_event_id_updated", phone, {
      phone,
      patientId: patient.id,
      appointmentId: existingAppointment.id,
      oldCalendarEventId,
      newCalendarEventId: event.id,
      start: selectedSlot.start,
      end: selectedSlot.end,
      source,
      route,
      reason
    });

    return {
      created: true,
      reused: false,
      eventId: event.id,
      appointmentId: existingAppointment.id,
      patientId: patient.id,
      summary,
      missingFields: [],
      selectedSlot
    };
  }

  private async createCalendarEvent(input: {
    patient: PatientRecord;
    phone: string;
    patientName: string;
    summary: string;
    selectedSlot: CalendarSlot;
    registrationData: AgendaParserOutput["registration_data"];
    parserOutput: AgendaParserOutput;
    appointmentId?: string;
  }) {
    return this.calendarService.createEvent({
      patientName: input.patientName,
      phone: input.phone,
      start: input.selectedSlot.start,
      end: input.selectedSlot.end,
      summary: input.summary,
      description: this.buildEventDescription(input),
      location: CLINIC_LOCATION,
      metadata: this.buildEventMetadata(input)
    });
  }

  private buildEventDescription(input: {
    patientName: string;
    phone: string;
    registrationData: AgendaParserOutput["registration_data"];
    parserOutput: AgendaParserOutput;
  }): string {
    return [
      `Paciente: ${input.patientName}`,
      `Telefone: ${input.phone}`,
      `CPF: ${input.registrationData.cpf}`,
      `Data de nascimento: ${input.registrationData.birth_date}`,
      "Origem: Mariana",
      "Tipo: primeira_consulta",
      "Status: scheduled",
      `Resumo: ${input.parserOutput.raw_summary}`
    ].join("\n");
  }

  private buildEventMetadata(input: {
    patient: PatientRecord;
    phone: string;
    patientName: string;
    registrationData: AgendaParserOutput["registration_data"];
    appointmentId?: string;
  }): Record<string, unknown> {
    return {
      source: "mariana",
      createdBySystem: true,
      phone: input.phone,
      cpf: input.registrationData.cpf,
      patientName: input.patientName,
      patientId: input.patient.id,
      appointmentId: input.appointmentId,
      appointmentType: "primeira_consulta",
      status: "scheduled"
    };
  }

  private async ensureCalendarEventMetadata(input: {
    calendarEvent: CalendarEventDetails;
    appointmentId: string;
    patient: PatientRecord;
    phone: string;
    patientName: string;
    summary: string;
    selectedSlot: CalendarSlot;
    registrationData: AgendaParserOutput["registration_data"];
    parserOutput: AgendaParserOutput;
    source: string;
    route?: string;
  }): Promise<void> {
    if (!this.calendarService.updateEvent) {
      return;
    }

    const expectedDescription = this.buildEventDescription(input);
    const expectedMetadata = this.buildEventMetadata({
      patient: input.patient,
      phone: input.phone,
      patientName: input.patientName,
      registrationData: input.registrationData,
      appointmentId: input.appointmentId
    });
    const currentPrivate = input.calendarEvent.extendedProperties ?? {};
    const metadataIncomplete = REQUIRED_EVENT_PRIVATE_KEYS.some((key) => !currentPrivate[key]);
    const descriptionIncomplete =
      !input.calendarEvent.description ||
      !input.calendarEvent.description.includes("Paciente:") ||
      !input.calendarEvent.description.includes("Origem: Mariana");
    const locationIncomplete = input.calendarEvent.location !== CLINIC_LOCATION;
    const summaryIncomplete = input.calendarEvent.summary !== input.summary;

    if (!metadataIncomplete && !descriptionIncomplete && !locationIncomplete && !summaryIncomplete) {
      return;
    }

    await this.calendarService.updateEvent(input.calendarEvent.id, {
      summary: input.summary,
      description: expectedDescription,
      location: CLINIC_LOCATION,
      metadata: expectedMetadata
    });

    await this.audit("calendar_event_metadata_updated", input.phone, {
      phone: input.phone,
      patientId: input.patient.id,
      appointmentId: input.appointmentId,
      oldCalendarEventId: input.calendarEvent.id,
      start: input.selectedSlot.start,
      end: input.selectedSlot.end,
      source: input.source,
      route: input.route
    });
  }

  private buildCandidateSlots(input: {
    from: Date;
    days: number;
    durationMinutes: number;
    requestedWeekday: number | null;
    preferences: SchedulingPreferences;
    busySlots: CalendarSlot[];
  }): CalendarSlot[] {
    const slots: CalendarSlot[] = [];

    for (let dayOffset = 0; dayOffset < input.days; dayOffset += 1) {
      const day = addDays(startOfDay(input.from), dayOffset);
      const weekday = day.getDay();

      if (weekday < 2 || weekday > 5) {
        continue;
      }

      if (input.requestedWeekday !== null && weekday !== input.requestedWeekday) {
        continue;
      }

      const periodWindows = getPeriodWindows(input.preferences.periods);

      for (const [startHour, endHour] of periodWindows) {
        const cursor = new Date(day);
        cursor.setHours(startHour, 0, 0, 0);
        const endBoundary = new Date(day);
        endBoundary.setHours(endHour, 0, 0, 0);

        while (addMinutes(cursor, input.durationMinutes) <= endBoundary) {
          if (cursor >= input.from) {
            const slot = {
              start: cursor.toISOString(),
              end: addMinutes(cursor, input.durationMinutes).toISOString()
            };

            if (!input.busySlots.some((busy) => overlaps(slot, busy))) {
              slots.push(slot);
            }
          }

          cursor.setMinutes(cursor.getMinutes() + SLOT_STEP_MINUTES);
        }
      }
    }

    return diversifySlots(slots);
  }

  private extractSelectedSlot(parserOutput: AgendaParserOutput): CalendarSlot | null {
    const dates = parserOutput.appointment_preferences.dates;
    const exact = dates.find((date) => /\d{4}-\d{2}-\d{2}T/.test(date));
    if (!exact) {
      return null;
    }

    const start = new Date(exact);
    if (Number.isNaN(start.getTime())) {
      return null;
    }

    return {
      start: start.toISOString(),
      end: addMinutes(start, DEFAULT_DURATION_MINUTES).toISOString()
    };
  }

  private extractExactSlotFromPreferences(
    preferences: SchedulingPreferences,
    durationMinutes: number
  ): CalendarSlot | null {
    const exact = preferences.dates?.find((date) => /\d{4}-\d{2}-\d{2}T/.test(date));
    if (!exact) {
      return null;
    }

    const start = new Date(exact);
    if (Number.isNaN(start.getTime())) {
      return null;
    }

    return {
      start: start.toISOString(),
      end: addMinutes(start, durationMinutes).toISOString()
    };
  }

  private getMissingRegistrationFields(
    registrationData: AgendaParserOutput["registration_data"]
  ): string[] {
    const missing: string[] = [];
    if (!registrationData.name) missing.push("name");
    if (!registrationData.cpf) missing.push("cpf");
    if (!registrationData.birth_date) missing.push("birthDate");
    return missing;
  }

  private async resolvePatientForAppointment(
    input: CreateAppointmentIfReadyInput,
    phone: string,
    source: string,
    route: string | undefined,
    selectedSlot: CalendarSlot,
    summary: string
  ): Promise<PatientRecord> {
    if (input.patient?.id) {
      await this.audit("patient_resolved_for_appointment", phone, {
        patientId: input.patient.id,
        start: selectedSlot.start,
        end: selectedSlot.end,
        source,
        route,
        summary
      });
      return input.patient;
    }

    if (!phone) {
      throw new Error("phone is required to resolve patient for appointment.");
    }

    if (!this.patientsRepository) {
      throw new Error("PatientsRepository is required to resolve patient for appointment.");
    }

    const existing = await this.patientsRepository.findByPhone(phone);
    const patient =
      existing ??
      (await this.patientsRepository.upsert({
        phone,
        name: input.registrationData.name ?? undefined,
        phoneVariants: generateBrazilWhatsappVariants(phone),
        metadata: {
          cpf: input.registrationData.cpf,
          birth_date: input.registrationData.birth_date
        }
      }));

    if (existing && (input.registrationData.name || input.registrationData.cpf || input.registrationData.birth_date)) {
      await this.patientsRepository.upsert({
        phone,
        name: input.registrationData.name ?? existing.name ?? undefined,
        phoneVariants: generateBrazilWhatsappVariants(phone),
        metadata: {
          ...(existing.metadata ?? {}),
          cpf: input.registrationData.cpf,
          birth_date: input.registrationData.birth_date
        }
      });
    }

    await this.audit("patient_resolved_for_appointment", phone, {
      patientId: patient.id,
      start: selectedSlot.start,
      end: selectedSlot.end,
      source,
      route,
      summary
    });

    return patient;
  }

  private async audit(event: string, phone: string, metadata: Record<string, unknown>): Promise<void> {
    await this.auditLogService?.create({
      event,
      phone,
      metadata
    });
  }
}

function resolveRequestedWeekday(preferences: SchedulingPreferences): number | null {
  if (preferences.requestedWeekday !== undefined && preferences.requestedWeekday !== null) {
    return preferences.requestedWeekday;
  }

  const raw = preferences.rawText?.toLowerCase() ?? "";
  if (raw.includes("domingo")) return 0;
  if (raw.includes("segunda")) return 1;
  if (raw.includes("terça") || raw.includes("terca")) return 2;
  if (raw.includes("quarta")) return 3;
  if (raw.includes("quinta")) return 4;
  if (raw.includes("sexta")) return 5;
  if (raw.includes("sábado") || raw.includes("sabado")) return 6;

  return null;
}

function getPeriodWindows(periods: SchedulingPreferences["periods"]): Array<[number, number]> {
  const safePeriods = periods?.length ? periods : ["any"];
  const windows: Array<[number, number]> = [];

  for (const period of safePeriods) {
    if (period === "morning") windows.push([9, 12]);
    if (period === "afternoon") windows.push([12, 19]);
    if (period === "evening") windows.push([17, 19]);
    if (period === "any") windows.push([CLINIC_START_HOUR, CLINIC_END_HOUR]);
  }

  return windows;
}

function overlaps(a: CalendarSlot, b: CalendarSlot): boolean {
  return new Date(a.start) < new Date(b.end) && new Date(a.end) > new Date(b.start);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function diversifySlots(slots: CalendarSlot[]): CalendarSlot[] {
  const byDay = new Map<string, CalendarSlot[]>();
  for (const slot of slots) {
    const day = slot.start.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), slot]);
  }

  const diversified: CalendarSlot[] = [];
  for (const daySlots of byDay.values()) {
    if (daySlots[0]) diversified.push(daySlots[0]);
  }

  for (const slot of slots) {
    if (!diversified.includes(slot)) {
      diversified.push(slot);
    }
  }

  return diversified;
}

export const schedulingInternals = {
  overlaps,
  addMinutes,
  addDays,
  SAO_PAULO_TIME_ZONE
};
