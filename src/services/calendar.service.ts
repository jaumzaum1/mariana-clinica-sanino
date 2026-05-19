export interface CalendarSlot {
  start: string;
  end: string;
}

export interface CalendarAppointmentInput extends CalendarSlot {
  patientName: string;
  phone: string;
  notes?: string;
}

export interface CalendarAppointment {
  id: string;
  start: string;
  end: string;
  mocked: boolean;
}

export class CalendarService {
  async listAvailableSlots(): Promise<CalendarSlot[]> {
    return [];
  }

  async createAppointment(input: CalendarAppointmentInput): Promise<CalendarAppointment> {
    return {
      id: `mock-calendar-${input.phone}`,
      start: input.start,
      end: input.end,
      mocked: true
    };
  }
}
