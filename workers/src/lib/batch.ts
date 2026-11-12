import { is, SQL } from 'drizzle-orm';
import type { DB } from '../db/client';

/** Một câu lệnh trong batch: query builder của Drizzle hoặc SQL thô (sql`...`) có tham số. */
export type BatchStatement = SQL | { toSQL(): { sql: string; params: unknown[] } };

/**
 * Thực thi nhiều câu lệnh trong MỘT transaction D1 (`D1Database.batch` — nguyên tử: tất cả hoặc không).
 * Hỗ trợ trộn query builder và SQL thô (Drizzle `db.batch` không hỗ trợ SQL thô).
 * Tham số luôn được bind — không nối chuỗi SQL.
 */
export async function runBatch(db: DB, statements: BatchStatement[]): Promise<D1Result<Record<string, unknown>>[]> {
  const internal = db as unknown as {
    session: { client: D1Database };
    dialect: { sqlToQuery(s: SQL): { sql: string; params: unknown[] } };
  };
  const d1 = internal.session.client;
  const prepared = statements.map((s) => {
    const q = is(s, SQL) ? internal.dialect.sqlToQuery(s) : s.toSQL();
    return d1.prepare(q.sql).bind(...q.params);
  });
  return d1.batch(prepared);
}

export const rowsOf = <T>(r: D1Result<Record<string, unknown>> | undefined) => (r?.results ?? []) as T[];
