import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import type { OutboundMessageSenderService } from "../services/outbound-message-sender.service.js";
import { normalizeBrazilPhone } from "../utils/phone.js";

const SendPendingBodySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional()
});

const QueueLatestDraftBodySchema = z.object({
  phone: z.string().min(1)
});

export interface OutboundRoutesOptions {
  outboundMessageSenderService?: OutboundMessageSenderService;
}

export async function outboundRoutes(
  app: FastifyInstance,
  options: OutboundRoutesOptions = {}
): Promise<void> {
  app.post("/internal/outbound/send-pending", async (request, reply) => {
    if (env.NODE_ENV === "production" && !env.ALLOW_INTERNAL_ROUTES) {
      return reply.status(404).send();
    }

    if (!options.outboundMessageSenderService) {
      return reply.status(503).send({
        ok: false,
        error: "Outbound message sender service is not configured"
      });
    }

    const parsed = SendPendingBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid send-pending payload"
      });
    }

    const maxLimit = env.NODE_ENV === "production" ? 10 : 100;
    const requestedLimit = parsed.data.limit ?? 5;
    const summary = await options.outboundMessageSenderService.sendPending(
      Math.min(requestedLimit, maxLimit)
    );

    return {
      ok: true,
      ...summary
    };
  });

  app.post("/internal/outbound/queue-latest-draft", async (request, reply) => {
    if (env.NODE_ENV === "production" && !env.ALLOW_INTERNAL_ROUTES) {
      return reply.status(404).send();
    }

    if (!options.outboundMessageSenderService) {
      return reply.status(503).send({
        ok: false,
        error: "Outbound message sender service is not configured"
      });
    }

    const parsed = QueueLatestDraftBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid queue-latest-draft payload"
      });
    }

    const queued = await options.outboundMessageSenderService.queueLatestDraft(
      normalizeBrazilPhone(parsed.data.phone)
    );

    return queued
      ? {
          ok: true,
          queued: 1,
          messageId: queued.id
        }
      : {
          ok: true,
          queued: 0
        };
  });
}
