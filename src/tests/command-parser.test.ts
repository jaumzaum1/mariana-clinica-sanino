import { describe, expect, it } from "vitest";
import { CommandParserAgent } from "../agents/command-parser.agent.js";

describe("CommandParserAgent", () => {
  const parser = new CommandParserAgent();

  it.each([
    ["ASSUMIR 5561996531507", "ASSUMIR"],
    ["LIBERAR 5561996531507", "LIBERAR"],
    ["RESUMO 5561996531507", "RESUMO"],
    ["OBS 5561996531507 paciente prefere manhã", "OBS"]
  ] as const)("recognizes %s", (text, expectedType) => {
    const command = parser.parse(text, "dr-joao");

    expect(command.type).toBe(expectedType);
    expect(command.phone).toBe("5561996531507");
    expect(command.requestedBy).toBe("dr-joao");
  });

  it("keeps OBS note text", () => {
    const command = parser.parse("OBS +55 (61) 99653-1507 paciente ansiosa");

    expect(command.note).toBe("paciente ansiosa");
  });
});
