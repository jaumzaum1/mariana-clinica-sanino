import { describe, expect, it } from "vitest";
import type { AgendaParserOutput } from "../schemas/agenda.schema.js";
import type {
  CalendarAppointmentInput,
  CalendarEventDetails,
  CalendarSlot,
  UpdateCalendarEventInput
} from "../services/calendar.service.js";
import { CalendarEventNotFoundError } from "../services/calendar.service.js";
import { SchedulingService } from "../services/scheduling.service.js";
import type {
  AppointmentRecord,
  AppointmentsRepository,
  CreateAuditLogInput,
  PatientRecord,
  PatientsRepository,
  SaveAppointmentInput,
  UpsertPatientInput
} from "../repositories/types.js";
import { AuditLogService } from "../services/audit-log.service.js";

class FakeCalendarService {
  createdEvents: CalendarAppointmentInput[] = [];
  updatedEvents: Array<{ id: string; input: UpdateCalendarEventInput }> = [];
  private readonly events = new Map<string, CalendarEventDetails>();
  private readonly missingEventIds = new Set<string>();
  private readonly cancelledEventIds = new Set<string>();
  transientErrorEventIds = new Set<string>();

  constructor(private readonly busySlots: CalendarSlot[] = []) {}

  async findBusySlots(): Promise<CalendarSlot[]> {
    return this.busySlots;
  }

  async createEvent(input: CalendarAppointmentInput) {
    this.createdEvents.push(input);
    const id = `event-${this.createdEvents.length}`;
    const event: CalendarEventDetails = {
      id,
      summary: input.summary,
      start: input.start,
      end: input.end,
      status: "confirmed",
      description: input.description,
      location: input.location,
      extendedProperties: Object.fromEntries(
        Object.entries(input.metadata ?? {}).map(([key, value]) => [key, String(value)])
      )
    };
    this.events.set(id, event);
    return {
      id,
      start: input.start,
      end: input.end
    };
  }

  seedEvent(event: CalendarEventDetails): void {
    this.events.set(event.id, event);
  }

  markMissing(eventId: string): void {
    this.missingEventIds.add(eventId);
    this.events.delete(eventId);
  }

  markCancelled(eventId: string): void {
    this.cancelledEventIds.add(eventId);
    const existing = this.events.get(eventId);
    if (existing) {
      this.events.set(eventId, { ...existing, status: "cancelled" });
    }
  }

  markTransientError(eventId: string): void {
    this.transientErrorEventIds.add(eventId);
  }

  async getEvent(id: string): Promise<CalendarEventDetails | null> {
    if (this.transientErrorEventIds.has(id)) {
      throw new Error("transient calendar error");
    }

    if (this.missingEventIds.has(id)) {
      throw new CalendarEventNotFoundError(id);
    }

    const event = this.events.get(id);
    if (!event) {
      throw new CalendarEventNotFoundError(id);
    }

    return event;
  }

  async updateEvent(id: string, input: UpdateCalendarEventInput): Promise<void> {
    this.updatedEvents.push({ id, input });
    const existing = this.events.get(id);
    if (!existing) {
      throw new CalendarEventNotFoundError(id);
    }

    this.events.set(id, {
      ...existing,
      summary: input.summary ?? existing.summary,
      description: input.description ?? existing.description,
      location: input.location ?? existing.location,
      extendedProperties: {
        ...(existing.extendedProperties ?? {}),
        ...Object.fromEntries(
          Object.entries(input.metadata ?? {}).map(([key, value]) => [key, String(value)])
        )
      }
    });
  }

  async updateEventMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    await this.updateEvent(id, { metadata });
  }
}

class FakeAppointmentsRepository implements AppointmentsRepository {
  appointments: AppointmentRecord[] = [];

  async create(input: SaveAppointmentInput): Promise<AppointmentRecord> {
    const appointment = {
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
    return (
      this.appointments.find(
        (appointment) =>
          appointment.patientId === input.patientId &&
          appointment.startsAt === input.startsAt &&
          appointment.endsAt === input.endsAt &&
          appointment.status === "scheduled"
      ) ?? null
    );
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
    appointment.metadata = {
      ...(appointment.metadata ?? {}),
      ...(input.metadata ?? {})
    };
    return appointment;
  }
}

class FakePatientsRepository implements PatientsRepository {
  patients: PatientRecord[] = [];

  constructor(initialPatients: PatientRecord[] = []) {
    this.patients = initialPatients;
  }

  async upsert(input: UpsertPatientInput): Promise<PatientRecord> {
    const existing = await this.findByPhone(input.phone);
    const patient = existing ?? {
      id: `patient-${this.patients.length + 1}`,
      phone: input.phone
    };
    patient.name = input.name ?? patient.name;
    patient.metadata = { ...(patient.metadata ?? {}), ...(input.metadata ?? {}) };
    if (!existing) this.patients.push(patient);
    return patient;
  }

  async findByPhone(phone: string): Promise<PatientRecord | null> {
    return this.patients.find((patient) => patient.phone === phone) ?? null;
  }

  async updateMemorySummary(patientId: string, memorySummary: string): Promise<PatientRecord> {
    const patient = this.patients.find((item) => item.id === patientId);
    if (!patient) throw new Error("Patient not found");
    patient.metadata = { ...(patient.metadata ?? {}), memory_summary: memorySummary };
    return patient;
  }
}

class FakeAuditLogsRepository {
  logs: CreateAuditLogInput[] = [];
  async create(input: CreateAuditLogInput): Promise<void> {
    this.logs.push(input);
  }
}

const baseNow = new Date(2026, 4, 18, 8, 0, 0, 0);
const patient: PatientRecord = {
  id: "patient-1",
  phone: "5561996531507",
  name: "Maria",
  metadata: {}
};

function parserOutput(overrides: Partial<AgendaParserOutput> = {}): AgendaParserOutput {
  return {
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
      periods: [],
      urgency: "normal",
      reason: "Consulta"
    },
    registration_data: {
      name: "Maria da Silva",
      cpf: "12345678900",
      birth_date: "1990-05-14",
      insurance: null
    },
    raw_summary: "Paciente quer consulta.",
    confidence: 0.9,
    ...overrides
  };
}

describe("SchedulingService", () => {
  it("does not offer Monday, Saturday or Sunday", async () => {
    const service = new SchedulingService(new FakeCalendarService());

    for (const [rawText, reason] of [
      ["segunda de manhã", "closed_day"],
      ["sábado de manhã", "saturday_requires_doctor"],
      ["domingo de manhã", "closed_day"]
    ] as const) {
      const result = await service.getAvailableSlots({
        preferences: { rawText },
        now: baseNow
      });

      expect(result.slots).toHaveLength(0);
      expect(result.blockedReason).toBe(reason);
    }
  });

  it("offers slots from Tuesday to Friday between 9h and 19h", async () => {
    const service = new SchedulingService(new FakeCalendarService());

    const result = await service.getAvailableSlots({
      preferences: {},
      now: baseNow,
      limit: 12
    });

    expect(result.slots.length).toBeGreaterThan(0);
    for (const slot of result.slots) {
      const start = new Date(slot.start);
      const end = new Date(slot.end);
      expect(start.getDay()).toBeGreaterThanOrEqual(2);
      expect(start.getDay()).toBeLessThanOrEqual(5);
      expect(start.getHours()).toBeGreaterThanOrEqual(9);
      expect(end.getHours()).toBeLessThanOrEqual(19);
    }
  });

  it("does not offer a slot that overlaps a mocked event", async () => {
    const busy = {
      start: new Date(2026, 4, 19, 9, 0).toISOString(),
      end: new Date(2026, 4, 19, 10, 30).toISOString()
    };
    const service = new SchedulingService(new FakeCalendarService([busy]));

    const result = await service.getAvailableSlots({
      preferences: { requestedWeekday: 2 },
      now: baseNow,
      limit: 3
    });

    expect(result.slots).not.toContainEqual(busy);
    expect(result.slots[0].start).not.toBe(busy.start);
  });

  it("returns 3 close slots for a generic consultation request", async () => {
    const service = new SchedulingService(new FakeCalendarService());

    const result = await service.getAvailableSlots({
      preferences: {},
      now: baseNow
    });

    expect(result.slots).toHaveLength(3);
  });

  it("returns Tuesday afternoon slots for a Tuesday afternoon request", async () => {
    const service = new SchedulingService(new FakeCalendarService());

    const result = await service.getAvailableSlots({
      preferences: { rawText: "terça à tarde", periods: ["afternoon"] },
      now: baseNow
    });

    expect(result.slots).toHaveLength(3);
    expect(result.slots.every((slot) => new Date(slot.start).getDay() === 2)).toBe(true);
    expect(result.slots.every((slot) => new Date(slot.start).getHours() >= 12)).toBe(true);
  });

  it("returns an exact free slot as selected available slot", async () => {
    const service = new SchedulingService(new FakeCalendarService());
    const exact = new Date(2026, 4, 19, 15, 30).toISOString();

    const result = await service.getAvailableSlots({
      preferences: { dates: [exact] },
      now: baseNow
    });

    expect(result.slots[0].start).toBe(exact);
  });

  it("returns alternatives when an exact slot is busy", async () => {
    const exact = new Date(2026, 4, 19, 15, 30).toISOString();
    const busy = {
      start: exact,
      end: new Date(2026, 4, 19, 17, 0).toISOString()
    };
    const service = new SchedulingService(new FakeCalendarService([busy]));

    const result = await service.getAvailableSlots({
      preferences: { dates: [exact] },
      now: baseNow
    });

    expect(result.slots[0].start).not.toBe(exact);
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it("creates appointment when slot and registration data are complete", async () => {
    const calendar = new FakeCalendarService();
    const appointments = new FakeAppointmentsRepository();
    const service = new SchedulingService(calendar, appointments);
    const selectedSlot = {
      start: new Date(2026, 4, 19, 15, 30).toISOString(),
      end: new Date(2026, 4, 19, 17, 0).toISOString()
    };

    const result = await service.createAppointmentIfReady({
      patient,
      registrationData: parserOutput().registration_data,
      selectedSlot,
      parserOutput: parserOutput()
    });

    expect(result).toMatchObject({ created: true, eventId: "event-1" });
    expect(calendar.createdEvents).toHaveLength(1);
    expect(calendar.createdEvents[0]).toMatchObject({
      summary: "Consulta - Maria da Silva - Dr. João Maldonado",
      location: "Clínica Sanino - Rua dos Bancários, 529 - Jardim Maria Izabel, Marília - SP",
      metadata: {
        source: "mariana",
        createdBySystem: true,
        phone: "5561996531507",
        cpf: "12345678900",
        patientName: "Maria da Silva",
        appointmentType: "primeira_consulta",
        status: "scheduled"
      }
    });
    expect(calendar.createdEvents[0].description).toContain("Paciente: Maria da Silva");
    expect(calendar.createdEvents[0].description).toContain("Origem: Mariana");
    expect(calendar.createdEvents[0].description).toContain("Tipo: primeira_consulta");
    expect(appointments.appointments).toHaveLength(1);
  });

  it("does not create appointment when registration data is missing", async () => {
    const calendar = new FakeCalendarService();
    const service = new SchedulingService(calendar, new FakeAppointmentsRepository());

    const result = await service.createAppointmentIfReady({
      patient,
      registrationData: { name: null, cpf: null, birth_date: null, insurance: null },
      selectedSlot: {
        start: new Date(2026, 4, 19, 15, 30).toISOString(),
        end: new Date(2026, 4, 19, 17, 0).toISOString()
      },
      parserOutput: parserOutput()
    });

    expect(result.created).toBe(false);
    expect(result.missingFields).toEqual(["name", "cpf", "birthDate"]);
    expect(calendar.createdEvents).toHaveLength(0);
  });

  it("does not create Saturday appointment and marks doctor review", async () => {
    const calendar = new FakeCalendarService();
    const service = new SchedulingService(calendar, new FakeAppointmentsRepository());

    const result = await service.createAppointmentIfReady({
      patient,
      registrationData: parserOutput().registration_data,
      selectedSlot: {
        start: new Date(2026, 4, 23, 10, 0).toISOString(),
        end: new Date(2026, 4, 23, 11, 30).toISOString()
      },
      parserOutput: parserOutput()
    });

    expect(result).toMatchObject({ created: false, needsDoctor: true, pauseAi: true });
    expect(calendar.createdEvents).toHaveLength(0);
  });

  it("creates patient when phone does not exist and saves appointment with patient id", async () => {
    const calendar = new FakeCalendarService();
    const appointments = new FakeAppointmentsRepository();
    const patients = new FakePatientsRepository();
    const auditLogs = new FakeAuditLogsRepository();
    const service = new SchedulingService(
      calendar,
      appointments,
      patients,
      new AuditLogService(auditLogs)
    );
    const selectedSlot = {
      start: new Date(2026, 4, 19, 15, 30).toISOString(),
      end: new Date(2026, 4, 19, 17, 0).toISOString()
    };

    const result = await service.createAppointmentIfReady({
      phone: "5561996531507",
      registrationData: parserOutput().registration_data,
      selectedSlot,
      parserOutput: parserOutput(),
      auditContext: { route: "/internal/scheduling/test-create-event" }
    });

    expect(result.patientId).toBe("patient-1");
    expect(appointments.appointments[0].patientId).toBe("patient-1");
    expect(patients.patients[0].metadata).toMatchObject({
      cpf: "12345678900",
      birth_date: "1990-05-14"
    });
    expect(auditLogs.logs.map((log) => log.event)).toEqual(
      expect.arrayContaining([
        "patient_resolved_for_appointment",
        "calendar_event_create_attempt",
        "calendar_event_created",
        "appointment_saved"
      ])
    );
  });

  it("uses existing patient and does not create duplicate appointment for same slot", async () => {
    const calendar = new FakeCalendarService();
    const appointments = new FakeAppointmentsRepository();
    const patients = new FakePatientsRepository([patient]);
    const service = new SchedulingService(calendar, appointments, patients);
    const selectedSlot = {
      start: new Date(2026, 4, 19, 15, 30).toISOString(),
      end: new Date(2026, 4, 19, 17, 0).toISOString()
    };

    const input = {
      phone: patient.phone,
      registrationData: parserOutput().registration_data,
      selectedSlot,
      parserOutput: parserOutput()
    };
    const first = await service.createAppointmentIfReady(input);
    const second = await service.createAppointmentIfReady(input);

    expect(first.appointmentId).toBe("appointment-1");
    expect(second.appointmentId).toBe("appointment-1");
    expect(second.reused).toBe(true);
    expect(appointments.appointments).toHaveLength(1);
    expect(calendar.createdEvents).toHaveLength(1);
  });

  it("reuses appointment when calendar event is still active", async () => {
    const calendar = new FakeCalendarService();
    const appointments = new FakeAppointmentsRepository();
    const patients = new FakePatientsRepository([patient]);
    const auditLogs = new FakeAuditLogsRepository();
    const service = new SchedulingService(
      calendar,
      appointments,
      patients,
      new AuditLogService(auditLogs)
    );
    const selectedSlot = {
      start: new Date(2026, 4, 19, 15, 30).toISOString(),
      end: new Date(2026, 4, 19, 17, 0).toISOString()
    };
    const input = {
      phone: patient.phone,
      registrationData: parserOutput().registration_data,
      selectedSlot,
      parserOutput: parserOutput(),
      auditContext: { route: "/internal/scheduling/test-create-event" }
    };

    const first = await service.createAppointmentIfReady(input);
    const second = await service.createAppointmentIfReady(input);

    expect(first.eventId).toBe("event-1");
    expect(second.eventId).toBe("event-1");
    expect(second.reused).toBe(true);
    expect(calendar.createdEvents).toHaveLength(1);
    expect(auditLogs.logs.map((log) => log.event)).toEqual(
      expect.arrayContaining([
        "calendar_event_reuse_validation_started",
        "calendar_event_reuse_validated",
        "appointment_reused",
        "calendar_event_reused"
      ])
    );
  });

  it("recreates calendar event when existing event was deleted", async () => {
    const calendar = new FakeCalendarService();
    const appointments = new FakeAppointmentsRepository();
    const patients = new FakePatientsRepository([patient]);
    const auditLogs = new FakeAuditLogsRepository();
    const service = new SchedulingService(
      calendar,
      appointments,
      patients,
      new AuditLogService(auditLogs)
    );
    const selectedSlot = {
      start: new Date(2026, 4, 19, 15, 30).toISOString(),
      end: new Date(2026, 4, 19, 17, 0).toISOString()
    };
    const input = {
      phone: patient.phone,
      registrationData: parserOutput().registration_data,
      selectedSlot,
      parserOutput: parserOutput()
    };

    const first = await service.createAppointmentIfReady(input);
    calendar.markMissing("event-1");

    const second = await service.createAppointmentIfReady(input);

    expect(first.eventId).toBe("event-1");
    expect(second.eventId).toBe("event-2");
    expect(second.reused).toBe(false);
    expect(appointments.appointments[0].calendarEventId).toBe("event-2");
    expect(calendar.createdEvents).toHaveLength(2);
    expect(auditLogs.logs.map((log) => log.event)).toEqual(
      expect.arrayContaining([
        "calendar_event_missing",
        "calendar_event_recreated",
        "appointment_calendar_event_id_updated"
      ])
    );
  });

  it("recreates calendar event when existing event is cancelled", async () => {
    const calendar = new FakeCalendarService();
    const appointments = new FakeAppointmentsRepository();
    const patients = new FakePatientsRepository([patient]);
    const service = new SchedulingService(calendar, appointments, patients);
    const selectedSlot = {
      start: new Date(2026, 4, 19, 15, 30).toISOString(),
      end: new Date(2026, 4, 19, 17, 0).toISOString()
    };
    const input = {
      phone: patient.phone,
      registrationData: parserOutput().registration_data,
      selectedSlot,
      parserOutput: parserOutput()
    };

    await service.createAppointmentIfReady(input);
    calendar.markCancelled("event-1");

    const second = await service.createAppointmentIfReady(input);

    expect(second.eventId).toBe("event-2");
    expect(appointments.appointments[0].calendarEventId).toBe("event-2");
  });

  it("does not recreate blindly when calendar validation fails transiently", async () => {
    const calendar = new FakeCalendarService();
    const appointments = new FakeAppointmentsRepository();
    const patients = new FakePatientsRepository([patient]);
    const auditLogs = new FakeAuditLogsRepository();
    const service = new SchedulingService(
      calendar,
      appointments,
      patients,
      new AuditLogService(auditLogs)
    );
    const selectedSlot = {
      start: new Date(2026, 4, 19, 15, 30).toISOString(),
      end: new Date(2026, 4, 19, 17, 0).toISOString()
    };
    const input = {
      phone: patient.phone,
      registrationData: parserOutput().registration_data,
      selectedSlot,
      parserOutput: parserOutput()
    };

    await service.createAppointmentIfReady(input);
    calendar.markTransientError("event-1");

    await expect(service.createAppointmentIfReady(input)).rejects.toThrow("transient calendar error");
    expect(calendar.createdEvents).toHaveLength(1);
    expect(auditLogs.logs.map((log) => log.event)).toContain("calendar_event_validation_failed");
  });

  it("updates incomplete calendar metadata without creating a new event", async () => {
    const calendar = new FakeCalendarService();
    const appointments = new FakeAppointmentsRepository();
    const patients = new FakePatientsRepository([patient]);
    const auditLogs = new FakeAuditLogsRepository();
    const service = new SchedulingService(
      calendar,
      appointments,
      patients,
      new AuditLogService(auditLogs)
    );
    const selectedSlot = {
      start: new Date(2026, 4, 19, 15, 30).toISOString(),
      end: new Date(2026, 4, 19, 17, 0).toISOString()
    };

    await service.createAppointmentIfReady({
      phone: patient.phone,
      registrationData: parserOutput().registration_data,
      selectedSlot,
      parserOutput: parserOutput()
    });

    calendar.seedEvent({
      id: "event-1",
      summary: "Consulta antiga",
      start: selectedSlot.start,
      end: selectedSlot.end,
      status: "confirmed",
      description: "incompleta",
      location: "Endereco antigo",
      extendedProperties: { source: "mariana" }
    });

    await service.createAppointmentIfReady({
      phone: patient.phone,
      registrationData: parserOutput().registration_data,
      selectedSlot,
      parserOutput: parserOutput()
    });

    expect(calendar.createdEvents).toHaveLength(1);
    expect(calendar.updatedEvents.some((item) => item.input.description?.includes("Paciente:"))).toBe(true);
    expect(auditLogs.logs.map((log) => log.event)).toContain("calendar_event_metadata_updated");
  });

  it("logs calendar failure and does not save incomplete appointment", async () => {
    class FailingCalendarService extends FakeCalendarService {
      async createEvent(): Promise<never> {
        throw new Error("calendar failed");
      }
    }
    const appointments = new FakeAppointmentsRepository();
    const auditLogs = new FakeAuditLogsRepository();
    const service = new SchedulingService(
      new FailingCalendarService(),
      appointments,
      new FakePatientsRepository([patient]),
      new AuditLogService(auditLogs)
    );

    await expect(
      service.createAppointmentIfReady({
        phone: patient.phone,
        registrationData: parserOutput().registration_data,
        selectedSlot: {
          start: new Date(2026, 4, 19, 15, 30).toISOString(),
          end: new Date(2026, 4, 19, 17, 0).toISOString()
        },
        parserOutput: parserOutput()
      })
    ).rejects.toThrow("calendar failed");

    expect(appointments.appointments).toHaveLength(0);
    expect(auditLogs.logs.map((log) => log.event)).toContain("calendar_event_failed");
  });
});
