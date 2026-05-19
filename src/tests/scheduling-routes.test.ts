import { describe, expect, it } from "vitest";
import type { CreateAuditLogInput } from "../repositories/types.js";
import { buildApp } from "../server/app.js";
import type { CreateAppointmentIfReadyInput } from "../services/scheduling.service.js";

function createAppWithSchedulingService(
  calls: CreateAppointmentIfReadyInput[],
  auditLogs: CreateAuditLogInput[] = []
) {
  return buildApp({
    dependencies: {
      auditLogService: {
        create: async (input: CreateAuditLogInput) => {
          auditLogs.push(input);
        }
      } as never,
      schedulingService: {
        getAvailableSlots: async () => ({ slots: [], alternatives: [] }),
        createAppointmentIfReady: async (input: CreateAppointmentIfReadyInput) => {
          calls.push(input);
          return {
            created: true,
            eventId: "event-1",
            appointmentId: "appointment-1",
            patientId: "patient-1",
            summary: "Consulta - João Maldonado - Dr. João Maldonado",
            missingFields: [],
            selectedSlot: input.selectedSlot ?? undefined
          };
        }
      } as never
    }
  });
}

describe("POST /internal/scheduling/test-create-event", () => {
  it("accepts the documented payload with timezone offset", async () => {
    const calls: CreateAppointmentIfReadyInput[] = [];
    const app = createAppWithSchedulingService(calls);

    const response = await app.inject({
      method: "POST",
      url: "/internal/scheduling/test-create-event",
      payload: {
        phone: "5561996531507",
        name: "João Maldonado",
        cpf: "12345678900",
        birthDate: "14/05/1990",
        start: "2026-05-20T15:00:00-03:00",
        end: "2026-05-20T16:30:00-03:00"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      eventId: "event-1",
      appointmentId: "appointment-1",
      patientId: "patient-1",
      summary: "Consulta - João Maldonado - Dr. João Maldonado"
    });
    expect(calls[0]).toMatchObject({
      phone: "5561996531507",
      registrationData: {
        name: "João Maldonado",
        cpf: "12345678900",
        birth_date: "14/05/1990"
      },
      selectedSlot: {
        start: "2026-05-20T18:00:00.000Z",
        end: "2026-05-20T19:30:00.000Z"
      }
    });
    expect(calls[0].auditContext).toMatchObject({
      route: "/internal/scheduling/test-create-event",
      source: "mariana"
    });

    await app.close();
  });

  it("accepts useful aliases", async () => {
    const calls: CreateAppointmentIfReadyInput[] = [];
    const auditLogs: CreateAuditLogInput[] = [];
    const app = createAppWithSchedulingService(calls, auditLogs);

    const response = await app.inject({
      method: "POST",
      url: "/internal/scheduling/test-create-event",
      payload: {
        telefone: "55 61 99653-1507",
        nomeCompleto: "João Maldonado",
        cpf: "12345678900",
        dataNascimento: "14/05/1990",
        startAt: "2026-05-20T15:00:00-03:00",
        endAt: "2026-05-20T16:30:00-03:00"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(calls[0].phone).toBe("5561996531507");
    expect(calls[0].registrationData.birth_date).toBe("14/05/1990");
    expect(auditLogs.map((log) => log.event)).toEqual([
      "scheduling_test_create_event_requested",
      "scheduling_test_create_event_completed"
    ]);

    await app.close();
  });

  it("rejects missing end with useful error details", async () => {
    const app = createAppWithSchedulingService([]);

    const response = await app.inject({
      method: "POST",
      url: "/internal/scheduling/test-create-event",
      payload: {
        phone: "5561996531507",
        name: "João Maldonado",
        cpf: "12345678900",
        birthDate: "14/05/1990",
        start: "2026-05-20T15:00:00-03:00"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      error: "Invalid test-create-event payload",
      expectedAnyOf: {
        end: ["end", "endAt", "fim"]
      }
    });
    expect(response.json().issues).toContain("end is required");
    expect(response.json().receivedKeys).toContain("start");

    await app.close();
  });

  it("rejects end before start", async () => {
    const app = createAppWithSchedulingService([]);

    const response = await app.inject({
      method: "POST",
      url: "/internal/scheduling/test-create-event",
      payload: {
        phone: "5561996531507",
        name: "João Maldonado",
        cpf: "12345678900",
        birthDate: "14/05/1990",
        start: "2026-05-20T16:30:00-03:00",
        end: "2026-05-20T15:00:00-03:00"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().issues).toContain("end must be after start");

    await app.close();
  });
});
