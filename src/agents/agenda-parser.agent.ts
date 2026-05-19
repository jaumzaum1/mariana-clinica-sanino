import {
  AgendaParserResultSchema,
  type AgendaParserResult
} from "../schemas/agenda.schema.js";
import type { OpenAIService } from "../services/openai.service.js";

export class AgendaParserAgent {
  constructor(private readonly openAIService: OpenAIService) {}

  async parse(message: string): Promise<AgendaParserResult> {
    const mockResult: AgendaParserResult = {
      intent: /consulta|agenda|horario|marcar/i.test(message) ? "schedule" : "none",
      preferredDates: [],
      preferredPeriod: "any",
      confidence: 0.6,
      needsHumanReview: false
    };

    const response = await this.openAIService.createStructuredResponse(
      {
        systemPrompt: "prompts/agenda-parser.system.md",
        input: message,
        schemaName: "AgendaParserResult"
      },
      mockResult
    );

    return AgendaParserResultSchema.parse(response.output);
  }
}
