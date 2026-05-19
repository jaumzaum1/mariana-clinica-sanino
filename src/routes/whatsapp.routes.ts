import type { FastifyInstance } from "fastify";
import { ZapiWebhookSchema } from "../schemas/webhook.schema.js";
import { LoggingService } from "../services/logging.service.js";

export async function whatsappRoutes(app: FastifyInstance): Promise<void> {
  const loggingService = new LoggingService(app.log);

  app.post("/webhooks/zapi", async (request, reply) => {
    const parsed = ZapiWebhookSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid Z-API webhook payload"
      });
    }

    loggingService.info({
      event: "zapi.webhook.received",
      phone: parsed.data.phone,
      metadata: parsed.data
    });

    return {
      ok: true,
      received: true
    };
  });
}
