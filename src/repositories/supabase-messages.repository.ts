import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageRecord, MessagesRepository, SaveMessageInput } from "./types.js";

interface MessageRow {
  id: string;
  patient_id: string | null;
  phone: string;
  text: string;
}

export class SupabaseMessagesRepository implements MessagesRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async saveInbound(input: SaveMessageInput): Promise<MessageRecord> {
    const { data, error } = await this.supabase
      .from("messages")
      .insert({
        patient_id: input.patientId,
        phone: input.phone,
        direction: "inbound",
        text: input.text,
        raw_payload: {
          ...((input.rawPayload && typeof input.rawPayload === "object"
            ? input.rawPayload
            : { value: input.rawPayload }) as Record<string, unknown>),
          mariana: {
            external_message_id: input.externalMessageId,
            message_type: input.messageType
          }
        },
        created_at: input.receivedAt?.toISOString()
      })
      .select("id, patient_id, phone, text")
      .single<MessageRow>();

    if (error) {
      throw error;
    }

    return {
      id: data.id,
      patientId: data.patient_id,
      phone: data.phone,
      text: data.text
    };
  }
}
