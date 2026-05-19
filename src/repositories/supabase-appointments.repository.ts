import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AppointmentRecord,
  AppointmentsRepository,
  SaveAppointmentInput
} from "./types.js";

interface AppointmentRow {
  id: string;
  patient_id: string | null;
  phone: string;
  calendar_event_id: string | null;
  status: string;
  starts_at: string;
  ends_at: string;
  metadata: Record<string, unknown> | null;
}

function toRecord(row: AppointmentRow): AppointmentRecord {
  return {
    id: row.id,
    patientId: row.patient_id ?? "",
    phone: row.phone,
    calendarEventId: row.calendar_event_id,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    metadata: row.metadata ?? {}
  };
}

const APPOINTMENT_COLUMNS =
  "id, patient_id, phone, calendar_event_id, status, starts_at, ends_at, metadata";

export class SupabaseAppointmentsRepository implements AppointmentsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async create(input: SaveAppointmentInput): Promise<AppointmentRecord> {
    if (!input.patientId) {
      throw new Error("patientId is required to create appointment.");
    }

    const { data, error } = await this.supabase
      .from("appointments")
      .insert({
        patient_id: input.patientId,
        phone: input.phone,
        calendar_event_id: input.calendarEventId,
        status: input.status,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        appointment_type: input.appointmentType,
        source: input.source,
        notes: input.notes,
        metadata: input.metadata ?? {}
      })
      .select(APPOINTMENT_COLUMNS)
      .single<AppointmentRow>();

    if (error) {
      throw error;
    }

    return toRecord(data);
  }

  async findScheduledByPatientSlot(input: {
    patientId: string;
    startsAt: string;
    endsAt: string;
  }): Promise<AppointmentRecord | null> {
    const { data, error } = await this.supabase
      .from("appointments")
      .select(APPOINTMENT_COLUMNS)
      .eq("patient_id", input.patientId)
      .eq("starts_at", input.startsAt)
      .eq("ends_at", input.endsAt)
      .eq("status", "scheduled")
      .maybeSingle<AppointmentRow>();

    if (error) {
      throw error;
    }

    return data ? toRecord(data) : null;
  }

  async updateCalendarEventId(input: {
    appointmentId: string;
    calendarEventId: string;
    metadata?: Record<string, unknown>;
  }): Promise<AppointmentRecord> {
    const { data: existing, error: existingError } = await this.supabase
      .from("appointments")
      .select(APPOINTMENT_COLUMNS)
      .eq("id", input.appointmentId)
      .maybeSingle<AppointmentRow>();

    if (existingError) {
      throw existingError;
    }

    if (!existing) {
      throw new Error(`Appointment ${input.appointmentId} not found.`);
    }

    const mergedMetadata = {
      ...(existing.metadata ?? {}),
      ...(input.metadata ?? {}),
      calendar_event_id_updated_at: new Date().toISOString()
    };

    const { data, error } = await this.supabase
      .from("appointments")
      .update({
        calendar_event_id: input.calendarEventId,
        metadata: mergedMetadata,
        updated_at: new Date().toISOString()
      })
      .eq("id", input.appointmentId)
      .select(APPOINTMENT_COLUMNS)
      .single<AppointmentRow>();

    if (error) {
      throw error;
    }

    return toRecord(data);
  }
}
