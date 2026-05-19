import {
  MarianaResponseOutputSchema,
  type MarianaResponseOutput
} from "../schemas/mariana.schema.js";
import type { AgendaParserOutput } from "../schemas/agenda.schema.js";
import type { StructuredAIService } from "../services/openai.service.js";
import type { PatientMemoryService } from "../services/patient-memory.service.js";
import { loadPrompt } from "../utils/prompts.js";

export interface MarianaAgentInput {
  phone: string;
  message: string;
  agenda: AgendaParserOutput;
  patientMemory?: string;
}

export class MarianaAgent {
  constructor(
    private readonly openAIService: StructuredAIService,
    private readonly patientMemoryService: PatientMemoryService,
    private readonly model: string
  ) {}

  async respond(input: MarianaAgentInput): Promise<MarianaResponseOutput> {
    const systemPrompt = await loadPrompt("prompts/mariana.system.md");
    const memory = await this.patientMemoryService.getSnapshot(input.phone);
    const mockResponse: MarianaResponseOutput = {
      messages: ["Olá! Sou a Mariana, da Clínica Sanino. Como posso te ajudar?"],
      intent: input.agenda.intent,
      status: input.agenda.should_pause_ai ? "paused" : "draft",
      tags_add: memory.tags,
      tags_remove: [],
      needs_doctor: input.agenda.needs_doctor,
      pause_ai: input.agenda.should_pause_ai,
      handoff_reason: input.agenda.should_pause_ai ? "Requer avaliação do Dr. João." : null,
      calendar_action: input.agenda.scheduling_action === "none" ? "none" : "collect_preferences",
      followup_action: "none",
      memory_summary: input.patientMemory ?? memory.summary ?? null
    };

    const response = await this.openAIService.createStructuredResponse(
      {
        systemPrompt,
        input: JSON.stringify({
          phone: input.phone,
          message: input.message,
          agenda: input.agenda,
          memory: input.patientMemory ?? memory.summary
        }),
        model: this.model,
        schemaName: "MarianaResponseOutput",
        schema: MarianaResponseOutputSchema,
        mockOutput: mockResponse
      }
    );

    return MarianaResponseOutputSchema.parse(response.output);
  }
}
