import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import type { OutboundMessageSenderService } from "../services/outbound-message-sender.service.js";

export interface OutboundRoutesOptions {
  outboundMessageSenderService?: OutboundMessageSenderService;
}

export async function outboundRoutes(
  app: FastifyInstance,
  options: OutboundRoutesOptions = {}
): Promise<void> {
  app.post("/internal/outbound/send-pending", async (_request, reply) => {
    if (env.NODE_ENV === "production" && !env.ALLOW_INTERNAL_ROUTES) {
      return reply.status(404).send();
    }

    if (!options.outboundMessageSenderService) {
      return reply.status(503).send({
        ok: false,
        error: "Outbound message sender service is not configured"
      });
    }

    const summary = await options.outboundMessageSenderService.sendPending();

    return {
      ok: true,
      ...summary
    };
  });
}
