import {
  MarianaResponseSchema,
  type MarianaResponse
} from "../schemas/mariana.schema.js";
import type { OpenAIService } from "../services/openai.service.js";
import type { PatientMemoryService } from "../services/patient-memory.service.js";

export interface MarianaAgentInput {
  phone: string;
  message: string;
}

export class MarianaAgent {
  constructor(
    private readonly openAIService: OpenAIService,
    private readonly patientMemoryService: PatientMemoryService
  ) {}

  async respond(input: MarianaAgentInput): Promise<MarianaResponse> {
    const memory = await this.patientMemoryService.getSnapshot(input.phone);
    const mockResponse: MarianaResponse = {
      message: "Olá! Sou a Mariana, da Clínica Sanino. Como posso te ajudar?",
      tone: "warm",
      shouldSend: true,
      handoffToHuman: false,
      tags: memory.tags
    };

    const response = await this.openAIService.createStructuredResponse(
      {
        systemPrompt: "prompts/mariana.system.md",
        input: input.message,
        schemaName: "MarianaResponse"
      },
      mockResponse
    );

    return MarianaResponseSchema.parse(response.output);
  }
}
