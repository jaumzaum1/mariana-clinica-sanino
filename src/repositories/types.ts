export interface PatientRecord {
  id: string;
  phone: string;
  name?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MessageRecord {
  id: string;
  patientId?: string | null;
  phone: string;
  text: string;
}

export type OutboundSendStatus =
  | "draft"
  | "processing"
  | "skipped"
  | "sent"
  | "send_failed";

export interface OutboundDraftMessageRecord extends MessageRecord {
  rawPayload: Record<string, unknown>;
  sendStatus?: OutboundSendStatus | null;
  sentAt?: string | null;
  providerMessageId?: string | null;
  sendError?: string | null;
}

export interface MessageBatchRecord {
  id: string;
  phone: string;
  status: "accumulating" | "ready" | "processed" | "failed";
  accumulatedText: string;
  messageIds: string[];
  lastMessageAt: string;
  processAfter: string;
  metadata?: Record<string, unknown>;
}

export interface UpsertPatientInput {
  phone: string;
  name?: string;
  phoneVariants: string[];
}

export interface SaveMessageInput {
  patientId?: string;
  phone: string;
  text: string;
  rawPayload: unknown;
  externalMessageId?: string;
  messageType: string;
  receivedAt?: Date;
}

export interface SaveOutboundDraftInput {
  patientId?: string;
  phone: string;
  text: string;
  metadata: {
    draft: true;
    sent: false;
    send_whatsapp_enabled: false;
    [key: string]: unknown;
  };
}

export interface CreateAuditLogInput {
  event: string;
  phone?: string;
  metadata?: unknown;
}

export interface UpsertMessageBatchInput {
  phone: string;
  text: string;
  messageId: string;
  receivedAt: Date;
  processAfter: Date;
}

export interface PatientsRepository {
  upsert(input: UpsertPatientInput): Promise<PatientRecord>;
  findByPhone(phone: string): Promise<PatientRecord | null>;
  updateMemorySummary(patientId: string, memorySummary: string): Promise<PatientRecord>;
}

export interface MessagesRepository {
  saveInbound(input: SaveMessageInput): Promise<MessageRecord>;
  saveOutboundDraft(input: SaveOutboundDraftInput): Promise<MessageRecord>;
  findPendingOutboundDrafts(limit?: number): Promise<OutboundDraftMessageRecord[]>;
  markOutboundProcessing(messageId: string): Promise<OutboundDraftMessageRecord | null>;
  markOutboundSkipped(messageId: string, metadata: Record<string, unknown>): Promise<MessageRecord>;
  markOutboundSent(
    messageId: string,
    providerMessageId: string | undefined,
    metadata: Record<string, unknown>
  ): Promise<MessageRecord>;
  markOutboundSendFailed(
    messageId: string,
    error: string,
    metadata: Record<string, unknown>
  ): Promise<MessageRecord>;
}

export interface AuditLogsRepository {
  create(input: CreateAuditLogInput): Promise<void>;
}

export interface MessageBatchesRepository {
  upsertAccumulating(input: UpsertMessageBatchInput): Promise<MessageBatchRecord>;
  findDue(now: Date, limit?: number): Promise<MessageBatchRecord[]>;
  findReady(limit?: number): Promise<MessageBatchRecord[]>;
  markReady(id: string): Promise<MessageBatchRecord>;
  markProcessed(id: string, metadata?: Record<string, unknown>): Promise<MessageBatchRecord>;
  markFailed(id: string, metadata?: Record<string, unknown>): Promise<MessageBatchRecord>;
}
