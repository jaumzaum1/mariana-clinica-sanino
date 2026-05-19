export interface SendWhatsappMessageInput {
  phone: string;
  message: string;
}

export interface SendWhatsappMessageResult {
  id: string;
  mocked: boolean;
}

export class ZapiService {
  async sendMessage(input: SendWhatsappMessageInput): Promise<SendWhatsappMessageResult> {
    return {
      id: `mock-zapi-${input.phone}`,
      mocked: true
    };
  }
}
