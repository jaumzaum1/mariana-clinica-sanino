import { describe, expect, it } from "vitest";
import { MarianaResponseSchema } from "../schemas/mariana.schema.js";

describe("MarianaResponseSchema", () => {
  it("accepts a valid Mariana response", () => {
    const response = MarianaResponseSchema.parse({
      message: "Olá! Posso te ajudar a marcar uma consulta.",
      tone: "warm",
      shouldSend: true,
      handoffToHuman: false,
      tags: ["agenda"]
    });

    expect(response.shouldSend).toBe(true);
  });
});
