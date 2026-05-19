import type { FastifyInstance } from "fastify";
import type { WebhookIngestionService } from "../services/webhook-ingestion.service.js";

export interface WhatsappRoutesOptions {
  webhookIngestionService?: WebhookIngestionService;
}

export async function whatsappRoutes(
  app: FastifyInstance,
  options: WhatsappRoutesOptions = {}
): Promise<void> {
  app.post("/webhooks/zapi", async (request, reply) => {
    if (!options.webhookIngestionService) {
      app.log.error("webhook_ingestion.unavailable");
      return reply.status(503).send({
        ok: false,
        error: "Webhook ingestion service is not configured"
      });
    }

    try {
      const result = await options.webhookIngestionService.ingestZapiWebhook(request.body);

      return {
        ok: true,
        received: true,
        phone: result.phone,
        messageId: result.messageId,
        batchId: result.batchId
      };
    } catch (error) {
      app.log.warn({ error }, "zapi.webhook.invalid_or_failed");
      return reply.status(400).send({
        ok: false,
        error: error instanceof Error ? error.message : "Invalid Z-API webhook payload"
      });
    }
  });
}
