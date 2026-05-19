import type {
  MessagesRepository,
  PatientsRepository
} from "../repositories/types.js";
import type { AuditLogService } from "./audit-log.service.js";
import type { MessageDebounceService } from "./message-debounce.service.js";
import { ZapiWebhookNormalizerService } from "./zapi-webhook-normalizer.service.js";

export interface WebhookIngestionResult {
  phone: string;
  patientId: string;
  messageId: string;
  batchId: string;
}

export class WebhookIngestionService {
  constructor(
    private readonly normalizer: ZapiWebhookNormalizerService,
    private readonly patientsRepository: PatientsRepository,
    private readonly messagesRepository: MessagesRepository,
    private readonly debounceService: MessageDebounceService,
    private readonly auditLogService: AuditLogService
  ) {}

  async ingestZapiWebhook(rawPayload: unknown): Promise<WebhookIngestionResult> {
    const normalized = this.normalizer.normalize(rawPayload);
    const receivedAt = normalized.timestamp ?? new Date();

    await this.auditLogService.create({
      event: "webhook_received",
      phone: normalized.phone,
      metadata: {
        messageId: normalized.messageId,
        senderName: normalized.senderName,
        messageType: normalized.messageType
      }
    });

    const patient = await this.patientsRepository.upsert({
      phone: normalized.phone,
      name: normalized.senderName,
      phoneVariants: normalized.phoneVariants
    });

    await this.auditLogService.create({
      event: "patient_upserted",
      phone: normalized.phone,
      metadata: {
        patientId: patient.id,
        phoneVariants: normalized.phoneVariants
      }
    });

    const message = await this.messagesRepository.saveInbound({
      patientId: patient.id,
      phone: normalized.phone,
      text: normalized.text,
      rawPayload: normalized.rawPayload,
      externalMessageId: normalized.messageId,
      messageType: normalized.messageType,
      receivedAt
    });

    await this.auditLogService.create({
      event: "message_saved",
      phone: normalized.phone,
      metadata: {
        patientId: patient.id,
        messageId: message.id,
        externalMessageId: normalized.messageId
      }
    });

    const batch = await this.debounceService.addMessage({
      phone: normalized.phone,
      text: normalized.text,
      messageId: message.id,
      receivedAt
    });

    return {
      phone: normalized.phone,
      patientId: patient.id,
      messageId: message.id,
      batchId: batch.id
    };
  }
}
