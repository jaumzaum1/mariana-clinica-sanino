import type { SupabaseClient } from "@supabase/supabase-js";
import type { PatientRecord, PatientsRepository, UpsertPatientInput } from "./types.js";

interface PatientRow {
  id: string;
  phone: string;
  name: string | null;
  metadata: Record<string, unknown>;
}

export class SupabasePatientsRepository implements PatientsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async upsert(input: UpsertPatientInput): Promise<PatientRecord> {
    const existing = await this.findByPhone(input.phone);
    const { data, error } = await this.supabase
      .from("patients")
      .upsert(
        {
          phone: input.phone,
          name: input.name,
          metadata: {
            ...(existing?.metadata ?? {}),
            whatsapp_variants: input.phoneVariants,
            ...(input.metadata ?? {})
          },
          updated_at: new Date().toISOString()
        },
        { onConflict: "phone" }
      )
      .select("id, phone, name, metadata")
      .single<PatientRow>();

    if (error) {
      throw error;
    }

    return {
      id: data.id,
      phone: data.phone,
      name: data.name,
      metadata: data.metadata
    };
  }

  async findByPhone(phone: string): Promise<PatientRecord | null> {
    const { data, error } = await this.supabase
      .from("patients")
      .select("id, phone, name, metadata")
      .eq("phone", phone)
      .maybeSingle<PatientRow>();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return {
      id: data.id,
      phone: data.phone,
      name: data.name,
      metadata: data.metadata
    };
  }

  async updateMemorySummary(patientId: string, memorySummary: string): Promise<PatientRecord> {
    const { data: current, error: selectError } = await this.supabase
      .from("patients")
      .select("id, phone, name, metadata")
      .eq("id", patientId)
      .single<PatientRow>();

    if (selectError) {
      throw selectError;
    }

    const { data, error } = await this.supabase
      .from("patients")
      .update({
        metadata: {
          ...current.metadata,
          memory_summary: memorySummary
        },
        notes: memorySummary,
        updated_at: new Date().toISOString()
      })
      .eq("id", patientId)
      .select("id, phone, name, metadata")
      .single<PatientRow>();

    if (error) {
      throw error;
    }

    return {
      id: data.id,
      phone: data.phone,
      name: data.name,
      metadata: data.metadata
    };
  }
}
