import { Hono } from 'hono';
import {
  adjustmentCreateSchema,
  adjustmentDecisionSchema,
  feePlanSchema,
  feePlanUpdateSchema,
  idParam,
  invoiceCancelSchema,
  invoiceCreateSchema,
  invoiceDraftUpdateSchema,
  invoiceGenerateSchema,
  invoiceIssueSchema,
  invoiceListQuery,
  paymentCreateSchema,
  paymentListQuery,
  dailyCollectionsQuery,
  studentFeePlanEndSchema,
  studentFeePlanSchema,
} from '@ecm/shared';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { requireAnyPermission, requireAuth, requirePermission } from '../middleware/auth';
import { auditMetaFrom } from '../services/audit.service';
import * as fee from '../services/fees.service';
import { parseJson, parseParams, parseQuery, parseWith } from '../validators/validate';

const read = requirePermission('fees.read');
const write = requirePermission('fees.write');

export const feePlanRoutes = new Hono<AppEnv>();
feePlanRoutes.use('*', requireAuth);
feePlanRoutes.get('/', read, async (c) => c.json({ data: await fee.listFeePlans(getDb(c.env.DB)) }));
feePlanRoutes.post('/', write, async (c) => c.json(await fee.createFeePlan(getDb(c.env.DB), auditMetaFrom(c), await parseJson(c, feePlanSchema)), 201));
feePlanRoutes.patch('/:id', write, async (c) => {
  const { id } = parseParams(c, idParam);
  await fee.updateFeePlan(getDb(c.env.DB), auditMetaFrom(c), id, await parseJson(c, feePlanUpdateSchema));
  return c.json({ ok: true });
});

export const studentFeeRoutes = new Hono<AppEnv>();
studentFeeRoutes.get('/:id/fees', requireAuth, requireAnyPermission('fees.read', 'self.read'), async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await fee.studentFees(getDb(c.env.DB), c.get('user'), id));
});
studentFeeRoutes.post('/:id/fee-plans', requireAuth, write, async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await fee.addStudentFeePlan(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id, await parseJson(c, studentFeePlanSchema)), 201);
});
export const studentFeePlanRoutes = new Hono<AppEnv>();
studentFeePlanRoutes.post('/:id/end', requireAuth, write, async (c) => {
  const { id } = parseParams(c, idParam);
  const { effectiveTo } = await parseJson(c, studentFeePlanEndSchema);
  await fee.endStudentFeePlan(getDb(c.env.DB), auditMetaFrom(c), id, effectiveTo);
  return c.json({ ok: true });
});

export const invoiceRoutes = new Hono<AppEnv>();
invoiceRoutes.use('*', requireAuth);
invoiceRoutes.get('/', read, async (c) => c.json(await fee.listInvoices(getDb(c.env.DB), parseQuery(c, invoiceListQuery))));
invoiceRoutes.post('/generate', write, async (c) => {
  const { period } = await parseJson(c, invoiceGenerateSchema);
  return c.json(await fee.generateMonthlyDrafts(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), period));
});
invoiceRoutes.post('/issue', write, async (c) => {
  const { ids } = await parseJson(c, invoiceIssueSchema);
  return c.json(await fee.issueInvoices(getDb(c.env.DB), auditMetaFrom(c), ids));
});
invoiceRoutes.post('/', write, async (c) => c.json(await fee.createInvoice(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), await parseJson(c, invoiceCreateSchema)), 201));
invoiceRoutes.get('/:id', requireAnyPermission('fees.read', 'self.read'), async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await fee.getInvoice(getDb(c.env.DB), c.get('user'), id));
});
invoiceRoutes.get('/:id/statement', requireAnyPermission('fees.read', 'self.read'), async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await fee.invoiceStatement(getDb(c.env.DB), c.get('user'), id));
});
invoiceRoutes.post('/:id/send', write, async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await fee.sendInvoiceToGuardians(getDb(c.env.DB), auditMetaFrom(c), id));
});
invoiceRoutes.patch('/:id', write, async (c) => {
  const { id } = parseParams(c, idParam);
  await fee.updateDraftInvoice(getDb(c.env.DB), auditMetaFrom(c), id, await parseJson(c, invoiceDraftUpdateSchema));
  return c.json({ ok: true });
});
invoiceRoutes.post('/:id/cancel', write, async (c) => {
  const { id } = parseParams(c, idParam);
  const { reason } = await parseJson(c, invoiceCancelSchema);
  await fee.cancelInvoice(getDb(c.env.DB), auditMetaFrom(c), id, reason);
  return c.json({ ok: true });
});
invoiceRoutes.post('/:id/payments', write, async (c) => {
  const { id } = parseParams(c, idParam);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const key = c.req.header('Idempotency-Key') ?? body.idempotencyKey;
  const input = parseWith(paymentCreateSchema, { ...body, idempotencyKey: key });
  const r = await fee.recordPayment(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id, input);
  return c.json(r, r.duplicate ? 200 : 201);
});
invoiceRoutes.post('/:id/adjustments', write, async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await fee.requestAdjustment(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id, await parseJson(c, adjustmentCreateSchema)), 201);
});

export const paymentRoutes = new Hono<AppEnv>();
paymentRoutes.use('*', requireAuth, read);
paymentRoutes.get('/', async (c) => c.json(await fee.listPayments(getDb(c.env.DB), parseQuery(c, paymentListQuery))));
paymentRoutes.get('/:id/receipt', async (c) => {
  const { id } = parseParams(c, idParam);
  return c.json(await fee.getReceipt(getDb(c.env.DB), id));
});

export const adjustmentRoutes = new Hono<AppEnv>();
adjustmentRoutes.use('*', requireAuth);
adjustmentRoutes.get('/', read, async (c) => {
  const { status } = parseWith(z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() }), c.req.query());
  return c.json({ data: await fee.listAdjustments(getDb(c.env.DB), status) });
});
for (const [path, approve] of [
  ['approve', true],
  ['reject', false],
] as const)
  adjustmentRoutes.post(`/:id/${path}`, requirePermission('fees.approve_adjustment'), async (c) => {
    const { id } = parseParams(c, idParam);
    const { note } = await parseJson(c, adjustmentDecisionSchema);
    await fee.decideAdjustment(getDb(c.env.DB), auditMetaFrom(c), c.get('user'), id, approve, note);
    return c.json({ ok: true });
  });

export const feeReportRoutes = new Hono<AppEnv>();
feeReportRoutes.use('*', requireAuth, read);
feeReportRoutes.get('/daily-collections', async (c) => c.json(await fee.dailyCollections(getDb(c.env.DB), parseQuery(c, dailyCollectionsQuery))));
