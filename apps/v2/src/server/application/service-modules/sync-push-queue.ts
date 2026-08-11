interface SyncPushItem {
  tableName: string;
  recordId: string;
  operation: string;
  updatedAt: string;
  data?: Record<string, unknown>;
}

export interface SyncPushPayload {
  deviceId: string;
  deviceToken: string;
  changes: SyncPushItem[];
}

export interface SyncPushResult {
  accepted: number;
  failed: number;
  errors: Array<{ recordId: string; error: string }>;
  conflicts: Array<{ recordId: string; message: string }>;
}
