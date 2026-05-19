import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env.js";
import type { ConversationProcessorService } from "../services/conversation-processor.service.js";

const SimulateConversationBodySchema = z.object({
  phone: z.string().min(1),
  messages: z.array(z.string().min(1)).min(1)
});

export interface ConversationRoutesOptions {
  conversationProcessorService?: ConversationProcessorService;
}

export async function conversationRoutes(
  app: FastifyInstance,
  options: ConversationRoutesOptions = {}
): Promise<void> {
  app.post("/internal/conversation/simulate", async (request, reply) => {
    if (env.NODE_ENV === "production") {
      return reply.status(404).send();
    }

    if (!options.conversationProcessorService) {
      return reply.status(503).send({
        ok: false,
        error: "Conversation processor service is not configured"
      });
    }

    const parsed = SimulateConversationBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid conversation simulate payload",
        issues: parsed.error.issues
      });
    }

    const result = await options.conversationProcessorService.simulateConversation(
      parsed.data.phone,
      parsed.data.messages
    );

    return {
      ok: true,
      ...result
    };
  });
}
