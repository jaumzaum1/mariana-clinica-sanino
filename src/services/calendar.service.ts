import { google, type calendar_v3 } from "googleapis";
import { env } from "../config/env.js";

export interface CalendarSlot {
  start: string;
  end: string;
}

export interface CalendarEvent extends CalendarSlot {
  id: string;
  summary?: string | null;
}

export interface CalendarEventDetails extends CalendarEvent {
  status?: string | null;
  description?: string | null;
  location?: string | null;
  extendedProperties?: Record<string, string>;
}

export interface UpdateCalendarEventInput {
  summary?: string;
  description?: string;
  location?: string;
  metadata?: Record<string, unknown>;
}

export class CalendarEventNotFoundError extends Error {
  readonly eventId: string;

  constructor(eventId: string) {
    super(`Calendar event ${eventId} not found.`);
    this.name = "CalendarEventNotFoundError";
    this.eventId = eventId;
  }
}

export function isEventAbsentForAgenda(event: CalendarEventDetails | null | undefined): boolean {
  if (!event) {
    return true;
  }

  return event.status === "cancelled";
}

export interface CalendarAppointmentInput extends CalendarSlot {
  patientName: string;
  phone: string;
  notes?: string;
  summary?: string;
  description?: string;
  location?: string;
  metadata?: Record<string, unknown>;
}

export interface CalendarAppointment {
  id: string;
  start: string;
  end: string;
  raw?: unknown;
}

export interface ListEventsInput {
  timeMin: string;
  timeMax: string;
}

export interface FindBusySlotsInput {
  start: string;
  end: string;
}

export class CalendarService {
  private readonly calendar: calendar_v3.Calendar | null;

  constructor(
    private readonly config = {
      calendarId: env.GOOGLE_CALENDAR_ID,
      serviceAccountKeyFile: env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
    }
  ) {
    if (!this.config.calendarId || !this.config.serviceAccountKeyFile) {
      this.calendar = null;
      return;
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: this.config.serviceAccountKeyFile,
      scopes: ["https://www.googleapis.com/auth/calendar"]
    });

    this.calendar = google.calendar({ version: "v3", auth });
  }

  async listEvents(input: ListEventsInput): Promise<CalendarEvent[]> {
    if (!this.calendar || !this.config.calendarId) {
      throw new Error("Google Calendar nao configurado.");
    }

    const response = await this.calendar.events.list({
      calendarId: this.config.calendarId,
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      singleEvents: true,
      orderBy: "startTime"
    });

    return (response.data.items ?? [])
      .filter((event) => event.start?.dateTime && event.end?.dateTime)
      .map((event) => ({
        id: event.id ?? "",
        summary: event.summary,
        start: event.start?.dateTime ?? "",
        end: event.end?.dateTime ?? ""
      }));
  }

  async findBusySlots(input: FindBusySlotsInput): Promise<CalendarSlot[]> {
    return this.listEvents({
      timeMin: input.start,
      timeMax: input.end
    });
  }

  async createEvent(input: CalendarAppointmentInput): Promise<CalendarAppointment> {
    if (!this.calendar || !this.config.calendarId) {
      throw new Error("Google Calendar nao configurado.");
    }

    const response = await this.calendar.events.insert({
      calendarId: this.config.calendarId,
      requestBody: {
        summary: input.summary ?? `Consulta - ${input.patientName}`,
        description:
          input.description ??
          [
            `Paciente: ${input.patientName}`,
            `Telefone: ${input.phone}`,
            input.notes ? `Observacoes: ${input.notes}` : undefined
          ]
            .filter(Boolean)
            .join("\n"),
        location: input.location,
        start: {
          dateTime: input.start,
          timeZone: "America/Sao_Paulo"
        },
        end: {
          dateTime: input.end,
          timeZone: "America/Sao_Paulo"
        },
        extendedProperties: {
          private: Object.fromEntries(
            Object.entries(input.metadata ?? {}).map(([key, value]) => [key, String(value)])
          )
        }
      }
    });

    return {
      id: response.data.id ?? "",
      start: input.start,
      end: input.end,
      raw: response.data
    };
  }

  async getEvent(id: string): Promise<CalendarEventDetails | null> {
    if (!this.calendar || !this.config.calendarId) {
      throw new Error("Google Calendar nao configurado.");
    }

    try {
      const response = await this.calendar.events.get({
        calendarId: this.config.calendarId,
        eventId: id
      });

      const event = response.data;
      if (!event.start?.dateTime || !event.end?.dateTime) {
        return null;
      }

      return {
        id: event.id ?? id,
        summary: event.summary,
        start: event.start.dateTime,
        end: event.end.dateTime,
        status: event.status,
        description: event.description,
        location: event.location,
        extendedProperties: event.extendedProperties?.private ?? {}
      };
    } catch (error) {
      if (isGoogleCalendarNotFoundError(error)) {
        throw new CalendarEventNotFoundError(id);
      }

      throw error;
    }
  }

  async updateEvent(id: string, input: UpdateCalendarEventInput): Promise<void> {
    if (!this.calendar || !this.config.calendarId) {
      throw new Error("Google Calendar nao configurado.");
    }

    const requestBody: calendar_v3.Schema$Event = {};

    if (input.summary !== undefined) {
      requestBody.summary = input.summary;
    }

    if (input.description !== undefined) {
      requestBody.description = input.description;
    }

    if (input.location !== undefined) {
      requestBody.location = input.location;
    }

    if (input.metadata) {
      const existing = await this.calendar.events.get({
        calendarId: this.config.calendarId,
        eventId: id
      });
      const currentPrivate = existing.data.extendedProperties?.private ?? {};

      requestBody.extendedProperties = {
        private: {
          ...currentPrivate,
          ...Object.fromEntries(
            Object.entries(input.metadata).map(([key, value]) => [key, String(value)])
          )
        }
      };
    }

    await this.calendar.events.patch({
      calendarId: this.config.calendarId,
      eventId: id,
      requestBody
    });
  }

  async updateEventMetadata(
    id: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await this.updateEvent(id, { metadata });
  }

  async createAppointment(input: CalendarAppointmentInput): Promise<CalendarAppointment> {
    return this.createEvent(input);
  }
}

function isGoogleCalendarNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: number; response?: { status?: number } };
  return candidate.code === 404 || candidate.response?.status === 404;
}
