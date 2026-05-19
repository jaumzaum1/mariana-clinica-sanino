import type {
  MessageBatchRecord,
  MessageBatchesRepository,
  UpsertMessageBatchInput
} from "../repositories/types.js";
import type { AuditLogService } from "./audit-log.service.js";

export interface MessageDebounceServiceOptions {
  windowMs: number;
}

export class MessageDebounceService {
  constructor(
    private readonly messageBatchesRepository: MessageBatchesRepository,
    private readonly auditLogService: AuditLogService,
    private readonly options: MessageDebounceServiceOptions
  ) {}

  async addMessage(input: Omit<UpsertMessageBatchInput, "processAfter">): Promise<MessageBatchRecord> {
    const processAfter = new Date(input.receivedAt.getTime() + this.options.windowMs);
    const batch = await this.messageBatchesRepository.upsertAccumulating({
      ...input,
      processAfter
    });

    await this.auditLogService.create({
      event: "debounce_batch_updated",
      phone: input.phone,
      metadata: {
        batchId: batch.id,
        messageIds: batch.messageIds,
        processAfter: batch.processAfter
      }
    });

    return batch;
  }

  async processDueBatches(now = new Date()): Promise<MessageBatchRecord[]> {
    const dueBatches = await this.messageBatchesRepository.findDue(now);
    const readyBatches: MessageBatchRecord[] = [];

    for (const batch of dueBatches) {
      const readyBatch = await this.messageBatchesRepository.markReady(batch.id);

      await this.auditLogService.create({
        event: "debounce_batch_ready",
        phone: readyBatch.phone,
        metadata: {
          batchId: readyBatch.id,
          messageIds: readyBatch.messageIds,
          accumulatedText: readyBatch.accumulatedText
        }
      });

      readyBatches.push(readyBatch);
    }

    return readyBatches;
  }
}
