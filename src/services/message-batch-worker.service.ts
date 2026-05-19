import type { FastifyBaseLogger } from "fastify";
import type { MessageDebounceService } from "./message-debounce.service.js";

export class MessageBatchWorkerService {
  private interval: NodeJS.Timeout | undefined;

  constructor(
    private readonly debounceService: MessageDebounceService,
    private readonly intervalMs: number,
    private readonly logger?: FastifyBaseLogger
  ) {}

  start(): void {
    if (this.interval) {
      return;
    }

    this.interval = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.interval) {
      return;
    }

    clearInterval(this.interval);
    this.interval = undefined;
  }

  async tick(): Promise<void> {
    try {
      const readyBatches = await this.debounceService.processDueBatches();
      if (readyBatches.length > 0) {
        this.logger?.info({ count: readyBatches.length }, "message_batches.processed");
      }
    } catch (error) {
      this.logger?.error({ error }, "message_batches.worker_error");
    }
  }
}
