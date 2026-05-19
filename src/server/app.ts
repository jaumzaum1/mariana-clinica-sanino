import Fastify, { type FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { createSupabaseClient } from "../db/supabase.js";
import { SupabaseAuditLogsRepository } from "../repositories/supabase-audit-logs.repository.js";
import { SupabaseMessageBatchesRepository } from "../repositories/supabase-message-batches.repository.js";
import { SupabaseMessagesRepository } from "../repositories/supabase-messages.repository.js";
import { SupabasePatientsRepository } from "../repositories/supabase-patients.repository.js";
import { commandsRoutes } from "../routes/commands.routes.js";
import { healthRoutes } from "../routes/health.routes.js";
import { whatsappRoutes } from "../routes/whatsapp.routes.js";
import { AuditLogService } from "../services/audit-log.service.js";
import { MessageBatchWorkerService } from "../services/message-batch-worker.service.js";
import { MessageDebounceService } from "../services/message-debounce.service.js";
import { WebhookIngestionService } from "../services/webhook-ingestion.service.js";
import { ZapiWebhookNormalizerService } from "../services/zapi-webhook-normalizer.service.js";

export interface AppDependencies {
  webhookIngestionService?: WebhookIngestionService;
  messageBatchWorkerService?: MessageBatchWorkerService;
}

export interface BuildAppOptions {
  dependencies?: AppDependencies;
  startWorker?: boolean;
}

function createDefaultDependencies(app: FastifyInstance): AppDependencies {
  const supabase = createSupabaseClient();

  if (!supabase) {
    app.log.warn("supabase.not_configured");
    return {};
  }

  const auditLogsRepository = new SupabaseAuditLogsRepository(supabase);
  const auditLogService = new AuditLogService(auditLogsRepository, app.log);
  const messageDebounceService = new MessageDebounceService(
    new SupabaseMessageBatchesRepository(supabase),
    auditLogService,
    { windowMs: env.DEBOUNCE_WINDOW_MS }
  );

  return {
    webhookIngestionService: new WebhookIngestionService(
      new ZapiWebhookNormalizerService(),
      new SupabasePatientsRepository(supabase),
      new SupabaseMessagesRepository(supabase),
      messageDebounceService,
      auditLogService
    ),
    messageBatchWorkerService: new MessageBatchWorkerService(
      messageDebounceService,
      env.BATCH_WORKER_INTERVAL_MS,
      app.log
    )
  };
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger:
      env.NODE_ENV === "test"
        ? false
        : {
            level: env.LOG_LEVEL
          }
  });

  const dependencies = options.dependencies ?? createDefaultDependencies(app);

  app.register(healthRoutes);
  app.register(whatsappRoutes, {
    webhookIngestionService: dependencies.webhookIngestionService
  });
  app.register(commandsRoutes);

  if (options.startWorker && dependencies.messageBatchWorkerService) {
    dependencies.messageBatchWorkerService.start();
    app.addHook("onClose", async () => {
      dependencies.messageBatchWorkerService?.stop();
    });
  }

  return app;
}
