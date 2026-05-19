import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("migrations", () => {
  it("creates local-time read views for appointments and audit logs", async () => {
    const migration = await readFile(
      "src/db/migrations/009_appointment_audit_and_local_time_views.sql",
      "utf8"
    );

    expect(migration).toContain("create or replace view appointments_br");
    expect(migration).toContain("timezone('America/Sao_Paulo', starts_at) as starts_at_br");
    expect(migration).toContain("create or replace view audit_logs_br");
    expect(migration).toContain("timezone('America/Sao_Paulo', created_at) as created_at_br");
  });
});
