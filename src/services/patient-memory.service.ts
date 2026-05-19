import type { Patient } from "../schemas/patient.schema.js";

export interface PatientMemorySnapshot {
  phone: string;
  patient?: Patient;
  summary: string;
  tags: string[];
}

export class PatientMemoryService {
  async getSnapshot(phone: string): Promise<PatientMemorySnapshot> {
    return {
      phone,
      summary: "Sem memoria persistida ainda.",
      tags: []
    };
  }

  async appendObservation(phone: string, observation: string): Promise<void> {
    void phone;
    void observation;
  }
}
