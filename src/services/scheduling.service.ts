import type { AgendaParserResult } from "../schemas/agenda.schema.js";
import type { CalendarService } from "./calendar.service.js";

export interface SchedulingDecision {
  status: "needs_more_info" | "ready_to_schedule" | "not_scheduling";
  reason: string;
}

export class SchedulingService {
  constructor(private readonly calendarService: CalendarService) {}

  async evaluateAgendaIntent(intent: AgendaParserResult): Promise<SchedulingDecision> {
    if (intent.intent === "none") {
      return { status: "not_scheduling", reason: "Mensagem nao contem intencao de agenda." };
    }

    const slots = await this.calendarService.listAvailableSlots();

    if (slots.length === 0) {
      return { status: "needs_more_info", reason: "Agenda ainda nao conectada." };
    }

    return { status: "ready_to_schedule", reason: "Ha horarios candidatos disponiveis." };
  }
}
