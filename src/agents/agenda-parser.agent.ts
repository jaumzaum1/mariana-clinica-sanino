import {
  AgendaParserOutputSchema,
  type AgendaParserOutput
} from "../schemas/agenda.schema.js";
import type { StructuredAIService } from "../services/openai.service.js";
import { loadPrompt } from "../utils/prompts.js";

export class AgendaParserAgent {
  constructor(
    private readonly openAIService: StructuredAIService,
    private readonly model: string
  ) {}

  async parse(message: string): Promise<AgendaParserOutput> {
    const systemPrompt = await loadPrompt("prompts/agenda-parser.system.md");
    const mockOutput: AgendaParserOutput = {
      intent: /consulta|agenda|horario|marcar/i.test(message) ? "schedule" : "none",
      scheduling_action: /consulta|agenda|horario|marcar/i.test(message)
        ? "collect_preferences"
        : "none",
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
        reason: null
      },
      registration_data: {
        name: null,
        cpf: null,
        birth_date: null,
        insurance: null
      },
      raw_summary: message,
      confidence: 0.6
    };

    const response = await this.openAIService.createStructuredResponse(
      {
        systemPrompt,
        input: message,
        model: this.model,
        schemaName: "AgendaParserOutput",
        schema: AgendaParserOutputSchema,
        mockOutput
      }
    );

    return AgendaParserOutputSchema.parse(response.output);
  }
}
