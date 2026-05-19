export interface OpenAIResponseRequest {
  systemPrompt: string;
  input: string;
  schemaName?: string;
}

export interface OpenAIResponseResult<T> {
  output: T;
  model: string;
  mocked: boolean;
}

export class OpenAIService {
  async createStructuredResponse<T>(
    _request: OpenAIResponseRequest,
    mockOutput: T
  ): Promise<OpenAIResponseResult<T>> {
    return {
      output: mockOutput,
      model: "mock-openai-responses-api",
      mocked: true
    };
  }
}
