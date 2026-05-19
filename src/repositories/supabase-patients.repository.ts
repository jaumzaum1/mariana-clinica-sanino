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
    const { data, error } = await this.supabase
      .from("patients")
      .upsert(
        {
          phone: input.phone,
          name: input.name,
          metadata: {
            whatsapp_variants: input.phoneVariants
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
}
