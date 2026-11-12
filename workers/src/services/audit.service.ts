import type { Context } from 'hono';
import { sql } from 'drizzle-orm';
import type { AppEnv } from '../env';
import type { DB } from '../db/client';
import { auditLogs } from '../db/schema';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: number | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  actorUserId?: number | null;
}

export interface AuditMeta {
  actorUserId: number | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export function auditMetaFrom(c: Context<AppEnv>): AuditMeta {
  const user = c.get('user') as AppEnv['Variables']['user'] | undefined;
  return {
    actorUserId: user?.id ?? null,
    ip: c.req.header('CF-Connecting-IP') ?? null,
    userAgent: c.req.header('User-Agent')?.slice(0, 300) ?? null,
    requestId: c.get('requestId') ?? null,
  };
}

const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));

/**
 * Tạo câu lệnh INSERT audit (chưa thực thi) để đưa vào cùng `db.batch([...])`
 * với thao tác nghiệp vụ — đảm bảo nhật ký và dữ liệu được ghi nguyên tử.
 */
export function auditInsert(db: DB, meta: AuditMeta, e: AuditEntry) {
  return db.insert(auditLogs).values({
    actorUserId: e.actorUserId !== undefined ? e.actorUserId : meta.actorUserId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    beforeData: json(e.before),
    afterData: json(e.after),
    reason: e.reason ?? null,
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  });
}

/**
 * Ghi nhật ký CHỈ KHI câu lệnh liền trước trong cùng batch có thay đổi dữ liệu (`changes() > 0`).
 * Dùng sau UPDATE có điều kiện version để không ghi nhật ký cho thao tác bị từ chối.
 */
export function auditIfChanged(_db: DB, meta: AuditMeta, e: AuditEntry) {
  const actor = e.actorUserId !== undefined ? e.actorUserId : meta.actorUserId;
  return sql`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data, reason, ip, user_agent, request_id)
    SELECT ${actor}, ${e.action}, ${e.entityType}, ${e.entityId ?? null}, ${json(e.before)}, ${json(e.after)}, ${e.reason ?? null}, ${meta.ip}, ${meta.userAgent}, ${meta.requestId}
    WHERE changes() > 0`;
}
