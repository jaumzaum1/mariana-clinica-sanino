import Fastify, { type FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { createSupabaseClient } from "../db/supabase.js";
import { AgendaParserAgent } from "../agents/agenda-parser.agent.js";
import { MarianaAgent } from "../agents/mariana.agent.js";
import { SupabaseAuditLogsRepository } from "../repositories/supabase-audit-logs.repository.js";
import { SupabaseMessageBatchesRepository } from "../repositories/supabase-message-batches.repository.js";
import { SupabaseMessagesRepository } from "../repositories/supabase-messages.repository.js";
import { SupabasePatientsRepository } from "../repositories/supabase-patients.repository.js";
import { batchesRoutes } from "../routes/batches.routes.js";
import { commandsRoutes } from "../routes/commands.routes.js";
import { healthRoutes } from "../routes/health.routes.js";
import { outboundRoutes } from "../routes/outbound.routes.js";
import { whatsappRoutes } from "../routes/whatsapp.routes.js";
import { AuditLogService } from "../services/audit-log.service.js";
import { ConversationProcessorService } from "../services/conversation-processor.service.js";
import { MessageBatchWorkerService } from "../services/message-batch-worker.service.js";
import { MessageDebounceService } from "../services/message-debounce.service.js";
import { OpenAIService } from "../services/openai.service.js";
import { OutboundMessageSenderService } from "../services/outbound-message-sender.service.js";
import { PatientMemoryService } from "../services/patient-memory.service.js";
import { WebhookIngestionService } from "../services/webhook-ingestion.service.js";
import { ZapiService } from "../services/zapi.service.js";
import { ZapiWebhookNormalizerService } from "../services/zapi-webhook-normalizer.service.js";

export interface AppDependencies {
  webhookIngestionService?: WebhookIngestionService;
  conversationProcessorService?: ConversationProcessorService;
  outboundMessageSenderService?: OutboundMessageSenderService;
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
  const patientsRepository = new SupabasePatientsRepository(supabase);
  const messagesRepository = new SupabaseMessagesRepository(supabase);
  const messageBatchesRepository = new SupabaseMessageBatchesRepository(supabase);
  const auditLogService = new AuditLogService(auditLogsRepository, app.log);
  const messageDebounceService = new MessageDebounceService(
    messageBatchesRepository,
    auditLogService,
    { windowMs: env.DEBOUNCE_WINDOW_MS }
  );
  const openAIService = new OpenAIService();
  const agendaParserAgent = new AgendaParserAgent(openAIService, env.OPENAI_MODEL_PARSER);
  const marianaAgent = new MarianaAgent(
    openAIService,
    new PatientMemoryService(),
    env.OPENAI_MODEL_MARIANA
  );
  const conversationProcessorService = new ConversationProcessorService(
    messageBatchesRepository,
    patientsRepository,
    messagesRepository,
    agendaParserAgent,
    marianaAgent,
    auditLogService,
    { sendWhatsappEnabled: env.SEND_WHATSAPP_ENABLED }
  );
  const outboundMessageSenderService = new OutboundMessageSenderService(
    messagesRepository,
    new ZapiService(),
    auditLogService,
    {
      sendWhatsappEnabled: env.SEND_WHATSAPP_ENABLED,
      whatsappMode: env.WHATSAPP_MODE,
      whatsappTestPhone: env.WHATSAPP_TEST_PHONE
    }
  );

  return {
    webhookIngestionService: new WebhookIngestionService(
      new ZapiWebhookNormalizerService(),
      patientsRepository,
      messagesRepository,
      messageDebounceService,
      auditLogService
    ),
    conversationProcessorService,
    outboundMessageSenderService,
    messageBatchWorkerService: new MessageBatchWorkerService(
      messageDebounceService,
      conversationProcessorService,
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
  app.register(batchesRoutes, {
    conversationProcessorService: dependencies.conversationProcessorService
  });
  app.register(outboundRoutes, {
    outboundMessageSenderService: dependencies.outboundMessageSenderService
  });

  if (options.startWorker && dependencies.messageBatchWorkerService) {
    dependencies.messageBatchWorkerService.start();
    app.addHook("onClose", async () => {
      dependencies.messageBatchWorkerService?.stop();
    });
  }

  return app;
}
