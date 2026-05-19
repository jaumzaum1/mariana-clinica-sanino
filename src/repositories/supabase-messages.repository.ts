import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  MessageRecord,
  MessagesRepository,
  OutboundDraftMessageRecord,
  SaveMessageInput,
  SaveOutboundDraftInput
} from "./types.js";

interface MessageRow {
  id: string;
  patient_id: string | null;
  phone: string;
  text: string;
  raw_payload?: Record<string, unknown> | null;
  send_status?: OutboundDraftMessageRecord["sendStatus"];
  sent_at?: string | null;
  provider_message_id?: string | null;
  send_error?: string | null;
}

const MESSAGE_COLUMNS =
  "id, patient_id, phone, text, raw_payload, send_status, sent_at, provider_message_id, send_error";

function toMessageRecord(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    patientId: row.patient_id,
    phone: row.phone,
    text: row.text
  };
}

function toOutboundRecord(row: MessageRow): OutboundDraftMessageRecord {
  return {
    ...toMessageRecord(row),
    rawPayload: row.raw_payload ?? {},
    sendStatus: row.send_status,
    sentAt: row.sent_at,
    providerMessageId: row.provider_message_id,
    sendError: row.send_error
  };
}

function mergeRawPayload(
  existing: Record<string, unknown> | null | undefined,
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const current = existing ?? {};
  const mariana = current.mariana && typeof current.mariana === "object" ? current.mariana : {};

  return {
    ...current,
    mariana: {
      ...mariana,
      ...metadata
    }
  };
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

  async saveOutboundDraft(input: SaveOutboundDraftInput): Promise<MessageRecord> {
    const { data, error } = await this.supabase
      .from("messages")
      .insert({
        patient_id: input.patientId,
        phone: input.phone,
        direction: "outbound",
        text: input.text,
        raw_payload: {
          mariana: input.metadata
        },
        send_status: "draft"
      })
      .select("id, patient_id, phone, text")
      .single<MessageRow>();

    if (error) {
      throw error;
    }

    return toMessageRecord(data);
  }

  async findPendingOutboundDrafts(limit = 25): Promise<OutboundDraftMessageRecord[]> {
    const { data, error } = await this.supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("direction", "outbound")
      .is("sent_at", null)
      .or("send_status.is.null,send_status.in.(draft,skipped,send_failed)")
      .order("created_at", { ascending: true })
      .limit(limit)
      .returns<MessageRow[]>();

    if (error) {
      throw error;
    }

    return data.map(toOutboundRecord);
  }

  async markOutboundProcessing(messageId: string): Promise<OutboundDraftMessageRecord | null> {
    const existing = await this.findOutboundById(messageId);

    if (
      !existing ||
      existing.sentAt ||
      existing.sendStatus === "sent" ||
      existing.sendStatus === "processing"
    ) {
      return null;
    }

    const { data, error } = await this.supabase
      .from("messages")
      .update({
        send_status: "processing",
        send_error: null,
        raw_payload: mergeRawPayload(existing.rawPayload, {
          send_status: "processing",
          processing_started_at: new Date().toISOString()
        })
      })
      .eq("id", messageId)
      .is("sent_at", null)
      .or("send_status.is.null,send_status.neq.processing")
      .select(MESSAGE_COLUMNS)
      .maybeSingle<MessageRow>();

    if (error) {
      throw error;
    }

    return data ? toOutboundRecord(data) : null;
  }

  async markOutboundSkipped(
    messageId: string,
    metadata: Record<string, unknown>
  ): Promise<MessageRecord> {
    const existing = await this.findOutboundById(messageId);
    const { data, error } = await this.supabase
      .from("messages")
      .update({
        send_status: "skipped",
        send_error: null,
        raw_payload: mergeRawPayload(existing?.rawPayload, {
          ...metadata,
          sent: false,
          send_status: "skipped"
        })
      })
      .eq("id", messageId)
      .select("id, patient_id, phone, text")
      .single<MessageRow>();

    if (error) {
      throw error;
    }

    return toMessageRecord(data);
  }

  async markOutboundSent(
    messageId: string,
    providerMessageId: string | undefined,
    metadata: Record<string, unknown>
  ): Promise<MessageRecord> {
    const existing = await this.findOutboundById(messageId);
    const { data, error } = await this.supabase
      .from("messages")
      .update({
        sent_at: new Date().toISOString(),
        provider_message_id: providerMessageId,
        send_status: "sent",
        send_error: null,
        raw_payload: mergeRawPayload(existing?.rawPayload, {
          ...metadata,
          draft: false,
          sent: true,
          send_status: "sent",
          provider_message_id: providerMessageId
        })
      })
      .eq("id", messageId)
      .is("sent_at", null)
      .select("id, patient_id, phone, text")
      .single<MessageRow>();

    if (error) {
      throw error;
    }

    return toMessageRecord(data);
  }

  async markOutboundSendFailed(
    messageId: string,
    errorMessage: string,
    metadata: Record<string, unknown>
  ): Promise<MessageRecord> {
    const existing = await this.findOutboundById(messageId);
    const { data, error } = await this.supabase
      .from("messages")
      .update({
        send_status: "send_failed",
        send_error: errorMessage,
        raw_payload: mergeRawPayload(existing?.rawPayload, {
          ...metadata,
          sent: false,
          send_status: "send_failed",
          send_error: errorMessage
        })
      })
      .eq("id", messageId)
      .select("id, patient_id, phone, text")
      .single<MessageRow>();

    if (error) {
      throw error;
    }

    return toMessageRecord(data);
  }

  private async findOutboundById(messageId: string): Promise<OutboundDraftMessageRecord | null> {
    const { data, error } = await this.supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("id", messageId)
      .eq("direction", "outbound")
      .maybeSingle<MessageRow>();

    if (error) {
      throw error;
    }

    return data ? toOutboundRecord(data) : null;
  }
}
