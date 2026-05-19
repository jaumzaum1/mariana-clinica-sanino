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
  locked_at?: string | null;
  lock_id?: string | null;
  send_attempts?: number;
}

const MESSAGE_COLUMNS =
  "id, patient_id, phone, text, raw_payload, send_status, sent_at, provider_message_id, send_error, locked_at, lock_id, send_attempts";

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
    sendError: row.send_error,
    lockedAt: row.locked_at,
    lockId: row.lock_id,
    sendAttempts: row.send_attempts ?? 0
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
        send_status: input.sendStatus ?? "draft"
      })
      .select("id, patient_id, phone, text")
      .single<MessageRow>();

    if (error) {
      throw error;
    }

    return toMessageRecord(data);
  }

  async findPendingOutboundForSend(limit = 5): Promise<OutboundDraftMessageRecord[]> {
    const { data, error } = await this.supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("direction", "outbound")
      .is("sent_at", null)
      .eq("send_status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit)
      .returns<MessageRow[]>();

    if (error) {
      throw error;
    }

    return data.map(toOutboundRecord);
  }

  async markOutboundSending(
    messageId: string,
    lockId: string
  ): Promise<OutboundDraftMessageRecord | null> {
    const existing = await this.findOutboundById(messageId);

    if (
      !existing ||
      existing.sentAt ||
      existing.sendStatus === "sent" ||
      existing.sendStatus !== "pending"
    ) {
      return null;
    }

    const { data, error } = await this.supabase
      .from("messages")
      .update({
        send_status: "sending",
        send_error: null,
        locked_at: new Date().toISOString(),
        lock_id: lockId,
        send_attempts: (existing.sendAttempts ?? 0) + 1,
        raw_payload: mergeRawPayload(existing.rawPayload, {
          send_status: "sending",
          lock_id: lockId,
          sending_started_at: new Date().toISOString()
        })
      })
      .eq("id", messageId)
      .is("sent_at", null)
      .eq("send_status", "pending")
      .select(MESSAGE_COLUMNS)
      .maybeSingle<MessageRow>();

    if (error) {
      throw error;
    }

    return data ? toOutboundRecord(data) : null;
  }

  async queueLatestOutboundDraft(phone: string): Promise<OutboundDraftMessageRecord | null> {
    const { data: draft, error: selectError } = await this.supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("direction", "outbound")
      .eq("phone", phone)
      .eq("send_status", "draft")
      .is("sent_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<MessageRow>();

    if (selectError) {
      throw selectError;
    }

    if (!draft) {
      return null;
    }

    const { data, error } = await this.supabase
      .from("messages")
      .update({
        send_status: "pending",
        send_error: null,
        raw_payload: mergeRawPayload(draft.raw_payload, {
          send_status: "pending",
          queued_at: new Date().toISOString()
        })
      })
      .eq("id", draft.id)
      .eq("send_status", "draft")
      .is("sent_at", null)
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
        locked_at: null,
        lock_id: null,
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
        locked_at: null,
        lock_id: null,
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
        locked_at: null,
        lock_id: null,
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
