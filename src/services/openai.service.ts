import OpenAI from "openai";
import { z, type ZodType } from "zod";
import { env } from "../config/env.js";
import { makeOpenAIStrictSchema } from "../utils/openai-json-schema.js";

export interface OpenAIResponseRequest {
  systemPrompt: string;
  input: string;
  model: string;
  schemaName: string;
  schema: ZodType;
  mockOutput?: unknown;
}

export interface OpenAIResponseResult<T> {
  output: T;
  model: string;
  mocked: boolean;
  durationMs: number;
}

export interface StructuredAIService {
  createStructuredResponse<T>(request: OpenAIResponseRequest): Promise<OpenAIResponseResult<T>>;
}

export class OpenAIService implements StructuredAIService {
  private readonly client: OpenAI | null;

  constructor(apiKey = env.OPENAI_API_KEY) {
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async createStructuredResponse<T>(request: OpenAIResponseRequest): Promise<OpenAIResponseResult<T>> {
    const startedAt = Date.now();

    if (!this.client) {
      if (request.mockOutput === undefined) {
        throw new Error("OPENAI_API_KEY ausente e nenhum mockOutput foi fornecido.");
      }

      return {
        output: request.schema.parse(request.mockOutput) as T,
        model: request.model,
        mocked: true,
        durationMs: Date.now() - startedAt
      };
    }

    const response = await this.client.responses.create({
      model: request.model,
      input: [
        {
          role: "system",
          content: request.systemPrompt
        },
        {
          role: "user",
          content: request.input
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: request.schemaName,
          schema: makeOpenAIStrictSchema(z.toJSONSchema(request.schema)),
          strict: true
        }
      }
    });

    const outputText = response.output_text;
    const output = request.schema.parse(JSON.parse(outputText)) as T;

    return {
      output,
      model: request.model,
      mocked: false,
      durationMs: Date.now() - startedAt
    };
  }
}
