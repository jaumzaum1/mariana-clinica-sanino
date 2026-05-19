import type { AgendaParserOutput } from "../schemas/agenda.schema.js";
import type { MarianaResponseOutput } from "../schemas/mariana.schema.js";
import type {
  MessageBatchesRepository,
  MessagesRepository,
  PatientsRepository
} from "../repositories/types.js";
import type { AgendaParserAgent } from "../agents/agenda-parser.agent.js";
import type { MarianaAgent } from "../agents/mariana.agent.js";
import type { AuditLogService } from "./audit-log.service.js";
import type { ZapiService } from "./zapi.service.js";

export interface ConversationProcessorOptions {
  sendWhatsappEnabled: boolean;
}

export interface ProcessedBatchSummary {
  batchId: string;
  phone: string;
  outboundMessageId?: string;
  status: "processed" | "failed";
  sendWhatsappEnabled: false;
  error?: string;
}

export interface ProcessReadyBatchesResult {
  processed: ProcessedBatchSummary[];
}

export class ConversationProcessorService {
  constructor(
    private readonly messageBatchesRepository: MessageBatchesRepository,
    private readonly patientsRepository: PatientsRepository,
    private readonly messagesRepository: MessagesRepository,
    private readonly agendaParserAgent: Pick<AgendaParserAgent, "parse">,
    private readonly marianaAgent: Pick<MarianaAgent, "respond">,
    private readonly auditLogService: AuditLogService,
    private readonly options: ConversationProcessorOptions,
    private readonly zapiService?: Pick<ZapiService, "sendMessage">
  ) {}

  async processReadyBatches(limit = 25): Promise<ProcessReadyBatchesResult> {
    const readyBatches = await this.messageBatchesRepository.findReady(limit);
    const processed: ProcessedBatchSummary[] = [];

    for (const batch of readyBatches) {
      processed.push(await this.processBatchSafely(batch.id, batch.phone, batch.accumulatedText));
    }

    return { processed };
  }

  private async processBatchSafely(
    batchId: string,
    phone: string,
    accumulatedText: string
  ): Promise<ProcessedBatchSummary> {
    try {
      return await this.processBatch(batchId, phone, accumulatedText);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao processar batch.";

      await this.messageBatchesRepository.markFailed(batchId, {
        error: {
          message,
          name: error instanceof Error ? error.name : "UnknownError"
        },
        failed_at: new Date().toISOString()
      });

      await this.auditLogService.create({
        event: "batch_processing_failed",
        phone,
        metadata: {
          batchId,
          error: message
        }
      });

      return {
        batchId,
        phone,
        status: "failed",
        sendWhatsappEnabled: false,
        error: message
      };
    }
  }

  private async processBatch(
    batchId: string,
    phone: string,
    accumulatedText: string
  ): Promise<ProcessedBatchSummary> {
    const startedAt = Date.now();

    await this.auditLogService.create({
      event: "batch_processing_started",
      phone,
      metadata: { batchId }
    });

    const patient = await this.patientsRepository.findByPhone(phone);
    if (!patient) {
      throw new Error(`Paciente nao encontrado para o batch ${batchId}.`);
    }

    const agenda = await this.agendaParserAgent.parse(accumulatedText);
    await this.auditLogService.create({
      event: "agenda_parser_completed",
      phone,
      metadata: {
        batchId,
        intent: agenda.intent,
        schedulingAction: agenda.scheduling_action,
        needsDoctor: agenda.needs_doctor,
        shouldPauseAi: agenda.should_pause_ai
      }
    });

    const mariana = await this.marianaAgent.respond({
      phone,
      message: accumulatedText,
      agenda,
      patientMemory:
        typeof patient.metadata?.memory_summary === "string"
          ? patient.metadata.memory_summary
          : undefined
    });

    const outbound = await this.saveDraft(patient.id, phone, batchId, agenda, mariana);

    if (mariana.memory_summary) {
      await this.patientsRepository.updateMemorySummary(patient.id, mariana.memory_summary);
    }

    await this.messageBatchesRepository.markProcessed(batchId, {
      agenda_parser_output: agenda,
      mariana_response_output: mariana,
      outbound_message_id: outbound.id,
      duration_ms: Date.now() - startedAt
    });

    await this.auditLogService.create({
      event: "batch_processed",
      phone,
      metadata: {
        batchId,
        outboundMessageId: outbound.id,
        durationMs: Date.now() - startedAt,
        sendWhatsappEnabled: false
      }
    });

    if (this.options.sendWhatsappEnabled) {
      await this.auditLogService.create({
        event: "whatsapp_send_skipped",
        phone,
        metadata: {
          batchId,
          reason: "Envio real desabilitado nesta etapa."
        }
      });
      void this.zapiService;
    }

    return {
      batchId,
      phone,
      outboundMessageId: outbound.id,
      status: "processed",
      sendWhatsappEnabled: false
    };
  }

  private async saveDraft(
    patientId: string,
    phone: string,
    batchId: string,
    agenda: AgendaParserOutput,
    mariana: MarianaResponseOutput
  ) {
    const text = mariana.messages.join("\n\n");

    const outbound = await this.messagesRepository.saveOutboundDraft({
      patientId,
      phone,
      text,
      metadata: {
        draft: true,
        sent: false,
        send_whatsapp_enabled: this.options.sendWhatsappEnabled,
        send_status: this.options.sendWhatsappEnabled ? "pending" : "draft",
        batch_id: batchId,
        agenda_parser_output: agenda,
        mariana_response_output: mariana
      },
      sendStatus: this.options.sendWhatsappEnabled ? "pending" : "draft"
    });

    await this.auditLogService.create({
      event: "mariana_draft_saved",
      phone,
      metadata: {
        batchId,
        outboundMessageId: outbound.id,
        needsDoctor: mariana.needs_doctor,
        pauseAi: mariana.pause_ai
      }
    });

    return outbound;
  }
}
