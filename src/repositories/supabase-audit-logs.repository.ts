import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditLogsRepository, CreateAuditLogInput } from "./types.js";

export class SupabaseAuditLogsRepository implements AuditLogsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async create(input: CreateAuditLogInput): Promise<void> {
    const { error } = await this.supabase.from("audit_logs").insert({
      event: input.event,
      phone: input.phone,
      metadata: input.metadata ?? {}
    });

    if (error) {
      throw error;
    }
  }
}
