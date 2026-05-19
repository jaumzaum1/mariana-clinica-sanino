import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import type { AuditLogService } from "../services/audit-log.service.js";
import type { SchedulingService } from "../services/scheduling.service.js";
import { normalizeBrazilPhone } from "../utils/phone.js";

const AvailableSlotsBodySchema = z.object({
  text: z.string().default(""),
  phone: z.string().optional(),
  preferences: z
    .object({
      periods: z.array(z.enum(["morning", "afternoon", "evening", "any"])).optional(),
      requestedWeekday: z.number().int().min(0).max(6).nullable().optional()
    })
    .optional()
});

const EXPECTED_TEST_CREATE_EVENT_KEYS = {
  phone: ["phone", "telefone"],
  name: ["name", "nome", "nomeCompleto"],
  cpf: ["cpf"],
  birthDate: ["birthDate", "dataNascimento", "data_nascimento"],
  start: ["start", "startAt", "inicio"],
  end: ["end", "endAt", "fim"]
} as const;

interface NormalizedTestCreateEventPayload {
  phone: string;
  name: string;
  cpf: string;
  birthDate: string;
  start: string;
  end: string;
}

export interface SchedulingRoutesOptions {
  schedulingService?: SchedulingService;
  auditLogService?: AuditLogService;
}

export async function schedulingRoutes(
  app: FastifyInstance,
  options: SchedulingRoutesOptions = {}
): Promise<void> {
  app.post("/internal/scheduling/available-slots", async (request, reply) => {
    if (env.NODE_ENV === "production" && !env.ALLOW_INTERNAL_ROUTES) {
      return reply.status(404).send();
    }

    if (!options.schedulingService) {
      return reply.status(503).send({ ok: false, error: "Scheduling service is not configured" });
    }

    const parsed = AvailableSlotsBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: "Invalid scheduling payload" });
    }

    const result = await options.schedulingService.getAvailableSlots({
      preferences: {
        rawText: parsed.data.text,
        periods: parsed.data.preferences?.periods,
        requestedWeekday: parsed.data.preferences?.requestedWeekday
      },
      durationMinutes: 90,
      limit: 3
    });

    return { ok: true, phone: parsed.data.phone, ...result };
  });

  app.post("/internal/scheduling/test-create-event", async (request, reply) => {
    if (env.NODE_ENV === "production" && !env.ALLOW_INTERNAL_ROUTES) {
      return reply.status(404).send();
    }

    if (!options.schedulingService) {
      return reply.status(503).send({ ok: false, error: "Scheduling service is not configured" });
    }

    const normalized = normalizeTestCreateEventPayload(request.body);
    if (!normalized.ok) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid test-create-event payload",
        receivedKeys: normalized.receivedKeys,
        expectedAnyOf: EXPECTED_TEST_CREATE_EVENT_KEYS,
        issues: normalized.issues
      });
    }

    const data = normalized.data;
    const phone = normalizeBrazilPhone(data.phone);
    const route = "/internal/scheduling/test-create-event";
    const summary = `Consulta - ${data.name} - Dr. João Maldonado`;

    await options.auditLogService?.create({
      event: "scheduling_test_create_event_requested",
      phone,
      metadata: {
        phone,
        start: data.start,
        end: data.end,
        source: "mariana",
        route,
        summary
      }
    });

    try {
      const result = await options.schedulingService.createAppointmentIfReady({
        phone,
        registrationData: {
          name: data.name,
          cpf: data.cpf,
          birth_date: data.birthDate,
          insurance: null
        },
        selectedSlot: {
          start: data.start,
          end: data.end
        },
        auditContext: {
          source: "mariana",
          route
        },
        parserOutput: {
          intent: "schedule",
          scheduling_action: "collect_preferences",
          clinical_risk: "none",
          needs_doctor: false,
          should_pause_ai: false,
          patient_profile: {
            name: data.name,
            phone,
            known_patient: null,
            notes: null
          },
          appointment_preferences: {
            dates: [data.start],
            periods: [],
            urgency: "normal",
            reason: "Teste manual"
          },
          registration_data: {
            name: data.name,
            cpf: data.cpf,
            birth_date: data.birthDate,
            insurance: null
          },
          raw_summary: "Teste manual de criacao de evento",
          confidence: 1
        }
      });

      await options.auditLogService?.create({
        event: "scheduling_test_create_event_completed",
        phone,
        metadata: {
          phone,
          patientId: result.patientId,
          appointmentId: result.appointmentId,
          calendarEventId: result.eventId,
          start: result.selectedSlot?.start,
          end: result.selectedSlot?.end,
          source: "mariana",
          route,
          summary: result.summary
        }
      });

      return {
        ok: true,
        eventId: result.eventId,
        appointmentId: result.appointmentId,
        patientId: result.patientId,
        start: result.selectedSlot?.start,
        end: result.selectedSlot?.end,
        summary: result.summary,
        ...result
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao criar evento teste.";
      await options.auditLogService?.create({
        event: "scheduling_test_create_event_failed",
        phone,
        metadata: {
          phone,
          start: data.start,
          end: data.end,
          source: "mariana",
          route,
          summary,
          error: message
        }
      });

      return reply.status(500).send({
        ok: false,
        error: message,
        details: {
          phone,
          start: data.start,
          end: data.end,
          route
        }
      });
    }
  });
}

function normalizeTestCreateEventPayload(input: unknown):
  | { ok: true; data: NormalizedTestCreateEventPayload }
  | { ok: false; receivedKeys: string[]; issues: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      receivedKeys: [],
      issues: ["body must be a JSON object"]
    };
  }

  const payload = input as Record<string, unknown>;
  const receivedKeys = Object.keys(payload);
  const issues: string[] = [];
  const raw = {
    phone: pickString(payload, EXPECTED_TEST_CREATE_EVENT_KEYS.phone),
    name: pickString(payload, EXPECTED_TEST_CREATE_EVENT_KEYS.name),
    cpf: pickString(payload, EXPECTED_TEST_CREATE_EVENT_KEYS.cpf),
    birthDate: pickString(payload, EXPECTED_TEST_CREATE_EVENT_KEYS.birthDate),
    start: pickString(payload, EXPECTED_TEST_CREATE_EVENT_KEYS.start),
    end: pickString(payload, EXPECTED_TEST_CREATE_EVENT_KEYS.end)
  };

  for (const [key, value] of Object.entries(raw)) {
    if (!value) {
      issues.push(`${key} is required`);
    }
  }

  const startDate = raw.start ? new Date(raw.start) : null;
  const endDate = raw.end ? new Date(raw.end) : null;

  if (raw.start && (!startDate || Number.isNaN(startDate.getTime()))) {
    issues.push("start must be a valid date-time with timezone, e.g. 2026-05-20T15:00:00-03:00");
  }

  if (raw.end && (!endDate || Number.isNaN(endDate.getTime()))) {
    issues.push("end must be a valid date-time with timezone, e.g. 2026-05-20T16:30:00-03:00");
  }

  if (startDate && endDate && !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
    if (endDate <= startDate) {
      issues.push("end must be after start");
    }
  }

  if (issues.length > 0) {
    return { ok: false, receivedKeys, issues };
  }

  return {
    ok: true,
    data: {
      phone: raw.phone!,
      name: raw.name!,
      cpf: raw.cpf!,
      birthDate: raw.birthDate!,
      start: startDate!.toISOString(),
      end: endDate!.toISOString()
    }
  };
}

function pickString(payload: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}
