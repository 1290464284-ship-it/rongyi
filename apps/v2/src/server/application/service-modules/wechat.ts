import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { SqliteWechatMessageRepository } from '../../infrastructure/repositories/core.repositories';
import type { AppContext } from '../../../domain/contracts';
import type { WechatMessageRepository } from '../ports';

const SENDABLE_WECHAT_STATUSES = new Set(['PENDING', 'DRAFT', 'IN_PROGRESS']);

export class WechatService {
  private readonly db: Database.Database;
  private readonly wechatRepository: WechatMessageRepository;

  constructor(db: Database.Database, wechatRepository?: WechatMessageRepository) {
    this.db = db;
    this.wechatRepository = wechatRepository ?? new SqliteWechatMessageRepository(db);
  }

  send(messageId: string, context: AppContext): Record<string, unknown> {
    const row = this.wechatRepository.findById(messageId, context.clinicId);
    if (!row) throw new NotFoundError('Wechat message not found');
    if (row.status === 'SENT') return { id: messageId, status: 'SENT' };
    if (!SENDABLE_WECHAT_STATUSES.has(row.status)) {
      throw new ConflictError('Wechat message cannot be sent from current status');
    }
    const now = context.now().toISOString();
    const changes = this.wechatRepository.markSent(messageId, now, now, context.clinicId);
    if (changes === 0) throw new ConflictError('Wechat message cannot be sent from current status');
    return { id: messageId, status: 'SENT' };
  }

  sendBatch(ids: string[], context: AppContext): { sent: number } {
    if (!Array.isArray(ids) || ids.length > 500) {
      throw new ValidationError('Send batch ids must be an array with at most 500 items');
    }
    for (const id of ids) this.send(id, context);
    return { sent: ids.length };
  }
}
