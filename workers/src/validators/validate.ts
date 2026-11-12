import type { Context } from 'hono';
import type { z } from 'zod';
import { Errors } from '../lib/errors';

function formatIssues(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

export function parseWith<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw Errors.validation(formatIssues(r.error));
  return r.data;
}

export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw Errors.validation([{ path: '', message: 'Nội dung gửi lên không phải JSON hợp lệ' }]);
  }
  return parseWith(schema, body);
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.infer<S> {
  return parseWith(schema, c.req.query());
}

export function parseParams<S extends z.ZodType>(c: Context, schema: S): z.infer<S> {
  return parseWith(schema, c.req.param());
}
