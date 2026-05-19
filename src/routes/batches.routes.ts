import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import type { ConversationProcessorService } from "../services/conversation-processor.service.js";

export interface BatchesRoutesOptions {
  conversationProcessorService?: ConversationProcessorService;
}

export async function batchesRoutes(
  app: FastifyInstance,
  options: BatchesRoutesOptions = {}
): Promise<void> {
  app.post("/internal/batches/process-ready", async (_request, reply) => {
    if (env.NODE_ENV === "production") {
      return reply.status(404).send();
    }

    if (!options.conversationProcessorService) {
      return reply.status(503).send({
        ok: false,
        error: "Conversation processor service is not configured"
      });
    }

    const result = await options.conversationProcessorService.processReadyBatches();

    return {
      ok: true,
      ...result
    };
  });
}
