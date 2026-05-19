import { describe, expect, it } from "vitest";
import { AgendaParserResultSchema } from "../schemas/agenda.schema.js";

describe("AgendaParserResultSchema", () => {
  it("accepts a valid agenda parser object", () => {
    const result = AgendaParserResultSchema.parse({
      intent: "schedule",
      patientName: "Maria",
      phone: "5561996531507",
      preferredDates: ["2026-05-20"],
      preferredPeriod: "morning",
      specialtyOrReason: "Consulta de rotina",
      confidence: 0.91,
      needsHumanReview: false
    });

    expect(result.intent).toBe("schedule");
  });
});
