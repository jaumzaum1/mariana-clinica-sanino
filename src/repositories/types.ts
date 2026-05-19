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

export interface MessageBatchRecord {
  id: string;
  phone: string;
  status: "accumulating" | "ready" | "processed";
  accumulatedText: string;
  messageIds: string[];
  lastMessageAt: string;
  processAfter: string;
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
}

export interface MessagesRepository {
  saveInbound(input: SaveMessageInput): Promise<MessageRecord>;
}

export interface AuditLogsRepository {
  create(input: CreateAuditLogInput): Promise<void>;
}

export interface MessageBatchesRepository {
  upsertAccumulating(input: UpsertMessageBatchInput): Promise<MessageBatchRecord>;
  findDue(now: Date, limit?: number): Promise<MessageBatchRecord[]>;
  markReady(id: string): Promise<MessageBatchRecord>;
}
