import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  MessageBatchRecord,
  MessageBatchesRepository,
  UpsertMessageBatchInput
} from "./types.js";

interface MessageBatchRow {
  id: string;
  phone: string;
  status: "accumulating" | "ready" | "processed";
  accumulated_text: string;
  message_ids: string[];
  last_message_at: string;
  process_after: string;
}

function toRecord(row: MessageBatchRow): MessageBatchRecord {
  return {
    id: row.id,
    phone: row.phone,
    status: row.status,
    accumulatedText: row.accumulated_text,
    messageIds: row.message_ids,
    lastMessageAt: row.last_message_at,
    processAfter: row.process_after
  };
}

export class SupabaseMessageBatchesRepository implements MessageBatchesRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async upsertAccumulating(input: UpsertMessageBatchInput): Promise<MessageBatchRecord> {
    const { data: existing, error: selectError } = await this.supabase
      .from("message_batches")
      .select("id, phone, status, accumulated_text, message_ids, last_message_at, process_after")
      .eq("phone", input.phone)
      .eq("status", "accumulating")
      .maybeSingle<MessageBatchRow>();

    if (selectError) {
      throw selectError;
    }

    if (existing) {
      const { data, error } = await this.supabase
        .from("message_batches")
        .update({
          accumulated_text: [existing.accumulated_text, input.text].filter(Boolean).join("\n"),
          message_ids: [...existing.message_ids, input.messageId],
          last_message_at: input.receivedAt.toISOString(),
          process_after: input.processAfter.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", existing.id)
        .select("id, phone, status, accumulated_text, message_ids, last_message_at, process_after")
        .single<MessageBatchRow>();

      if (error) {
        throw error;
      }

      return toRecord(data);
    }

    const { data, error } = await this.supabase
      .from("message_batches")
      .insert({
        phone: input.phone,
        status: "accumulating",
        accumulated_text: input.text,
        message_ids: [input.messageId],
        last_message_at: input.receivedAt.toISOString(),
        process_after: input.processAfter.toISOString()
      })
      .select("id, phone, status, accumulated_text, message_ids, last_message_at, process_after")
      .single<MessageBatchRow>();

    if (error) {
      throw error;
    }

    return toRecord(data);
  }

  async findDue(now: Date, limit = 25): Promise<MessageBatchRecord[]> {
    const { data, error } = await this.supabase
      .from("message_batches")
      .select("id, phone, status, accumulated_text, message_ids, last_message_at, process_after")
      .eq("status", "accumulating")
      .lte("process_after", now.toISOString())
      .order("process_after", { ascending: true })
      .limit(limit)
      .returns<MessageBatchRow[]>();

    if (error) {
      throw error;
    }

    return data.map(toRecord);
  }

  async markReady(id: string): Promise<MessageBatchRecord> {
    const { data, error } = await this.supabase
      .from("message_batches")
      .update({
        status: "ready",
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select("id, phone, status, accumulated_text, message_ids, last_message_at, process_after")
      .single<MessageBatchRow>();

    if (error) {
      throw error;
    }

    return toRecord(data);
  }
}
