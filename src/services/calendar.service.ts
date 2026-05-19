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

  async getEvent(id: string): Promise<CalendarEvent | null> {
    if (!this.calendar || !this.config.calendarId) {
      throw new Error("Google Calendar nao configurado.");
    }

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
      end: event.end.dateTime
    };
  }

  async updateEventMetadata(
    id: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    if (!this.calendar || !this.config.calendarId) {
      throw new Error("Google Calendar nao configurado.");
    }

    const existing = await this.calendar.events.get({
      calendarId: this.config.calendarId,
      eventId: id
    });
    const currentPrivate = existing.data.extendedProperties?.private ?? {};

    await this.calendar.events.patch({
      calendarId: this.config.calendarId,
      eventId: id,
      requestBody: {
        extendedProperties: {
          private: {
            ...currentPrivate,
            ...Object.fromEntries(
              Object.entries(metadata).map(([key, value]) => [key, String(value)])
            )
          }
        }
      }
    });
  }

  async createAppointment(input: CalendarAppointmentInput): Promise<CalendarAppointment> {
    return this.createEvent(input);
  }
}
