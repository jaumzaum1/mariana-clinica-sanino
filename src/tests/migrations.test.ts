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

  it("adds human-readable local-time text columns to br views", async () => {
    const migration = await readFile(
      "src/db/migrations/010_calendar_reuse_validation_and_br_views.sql",
      "utf8"
    );

    expect(migration).toContain("drop view if exists appointments_br");
    expect(migration).toContain("drop view if exists audit_logs_br");
    expect(migration).toContain("create view appointments_br");
    expect(migration).toContain("starts_at_br_text");
    expect(migration).toContain("ends_at_br_text");
    expect(migration).toContain("created_at_br_text");
    expect(migration).toContain("updated_at_br_text");
    expect(migration).toContain("create view audit_logs_br");
    expect(migration).toContain("created_at_br_text");
    expect(migration).not.toContain("create or replace view");
  });
});
