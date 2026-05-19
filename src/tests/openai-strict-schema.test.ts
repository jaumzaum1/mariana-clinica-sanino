import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgendaParserOutputSchema } from "../schemas/agenda.schema.js";
import { MarianaResponseOutputSchema } from "../schemas/mariana.schema.js";
import { ensureStrictJsonSchema, type JsonSchema } from "../utils/openai-json-schema.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRequiredIsComplete(schema: unknown, path = "$"): void {
  if (Array.isArray(schema)) {
    schema.forEach((item, index) => assertRequiredIsComplete(item, `${path}[${index}]`));
    return;
  }

  if (!isRecord(schema)) {
    return;
  }

  if (isRecord(schema.properties)) {
    const propertyKeys = Object.keys(schema.properties).sort();
    expect(schema.additionalProperties, `${path}.additionalProperties`).toBe(false);
    expect(schema.required, `${path}.required`).toEqual(propertyKeys);
  }

  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" && isRecord(value)) {
      for (const [propertyName, propertySchema] of Object.entries(value)) {
        assertRequiredIsComplete(propertySchema, `${path}.properties.${propertyName}`);
      }
      continue;
    }

    assertRequiredIsComplete(value, `${path}.${key}`);
  }
}

describe("OpenAI strict JSON Schema", () => {
  it("ensures nested object schemas have complete required and additionalProperties=false", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        nested: {
          type: "object",
          properties: {
            a: { type: "string" },
            b: { type: "number" }
          }
        },
        list: {
          type: "array",
          items: {
            type: "object",
            properties: {
              c: { type: "boolean" }
            }
          }
        }
      },
      required: ["name"]
    };

    const strictSchema = ensureStrictJsonSchema(schema);

    assertRequiredIsComplete(strictSchema);
  });

  it("creates an OpenAI-valid strict schema for AgendaParserOutput", () => {
    const schema = ensureStrictJsonSchema(z.toJSONSchema(AgendaParserOutputSchema));

    assertRequiredIsComplete(schema);

    const patientProfile = (schema.properties as Record<string, JsonSchema>).patient_profile;
    expect(patientProfile.required).toContain("name");
    expect(patientProfile.required).toEqual(["name", "phone", "known_patient", "notes"].sort());
  });

  it("creates an OpenAI-valid strict schema for MarianaResponseOutput", () => {
    const schema = ensureStrictJsonSchema(z.toJSONSchema(MarianaResponseOutputSchema));

    assertRequiredIsComplete(schema);
  });
});
