export type JsonSchema = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureObjectStrict(schema: Record<string, unknown>): void {
  if (schema.type === "object" || isRecord(schema.properties)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    schema.additionalProperties = false;
    schema.required = Object.keys(properties).sort();
  }
}

function walkSchema(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      walkSchema(item);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  ensureObjectStrict(value);

  for (const key of ["properties", "$defs", "definitions"] as const) {
    const nested = value[key];
    if (isRecord(nested)) {
      for (const child of Object.values(nested)) {
        walkSchema(child);
      }
    }
  }

  for (const key of ["items", "additionalItems", "contains", "not", "if", "then", "else"] as const) {
    walkSchema(value[key]);
  }

  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"] as const) {
    walkSchema(value[key]);
  }
}

export function ensureStrictJsonSchema<TSchema extends JsonSchema>(schema: TSchema): TSchema {
  const clone = structuredClone(schema);
  walkSchema(clone);
  return clone as TSchema;
}

export const makeOpenAIStrictSchema = ensureStrictJsonSchema;
