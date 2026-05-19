import { describe, expect, it } from "vitest";
import { AgendaParserAgent } from "../agents/agenda-parser.agent.js";
import { MarianaAgent } from "../agents/mariana.agent.js";
import type { OpenAIResponseRequest, OpenAIResponseResult } from "../services/openai.service.js";
import { PatientMemoryService } from "../services/patient-memory.service.js";

class FakeStructuredAIService {
  constructor(private readonly output: unknown) {}

  async createStructuredResponse<T>(
    request: OpenAIResponseRequest
  ): Promise<OpenAIResponseResult<T>> {
    return {
      output: request.schema.parse(this.output) as T,
      model: request.model,
      mocked: true,
      durationMs: 1
    };
  }
}

describe("structured agents", () => {
  it("AgendaParserAgent validates structured output", async () => {
    const agent = new AgendaParserAgent(
      new FakeStructuredAIService({
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
          periods: ["morning"],
          urgency: "normal",
          reason: "Consulta"
        },
        registration_data: {
          name: null,
          cpf: null,
          birth_date: null,
          insurance: null
        },
        raw_summary: "Paciente quer marcar consulta.",
        confidence: 0.9
      }),
      "mock-parser"
    );

    const output = await agent.parse("Quero marcar consulta pela manhã");

    expect(output).toMatchObject({
      intent: "schedule",
      scheduling_action: "collect_preferences",
      confidence: 0.9
    });
  });

  it("MarianaAgent validates structured output", async () => {
    const agent = new MarianaAgent(
      new FakeStructuredAIService({
        messages: ["Claro, posso te ajudar com a consulta."],
        intent: "schedule",
        status: "draft",
        tags_add: ["agenda"],
        tags_remove: [],
        needs_doctor: false,
        pause_ai: false,
        handoff_reason: null,
        calendar_action: "collect_preferences",
        followup_action: "none",
        memory_summary: "Paciente quer consulta."
      }),
      new PatientMemoryService(),
      "mock-mariana"
    );

    const output = await agent.respond({
      phone: "5561996531507",
      message: "Quero marcar consulta",
      agenda: {
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
          reason: null
        },
        registration_data: {
          name: null,
          cpf: null,
          birth_date: null,
          insurance: null
        },
        raw_summary: "Paciente quer marcar consulta.",
        confidence: 0.9
      }
    });

    expect(output).toMatchObject({
      messages: ["Claro, posso te ajudar com a consulta."],
      status: "draft",
      pause_ai: false
    });
  });
});
