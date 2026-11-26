import { Router, Request } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { isValidObjectId, Model } from 'mongoose';
import { z } from 'zod';
import {
  AdminUser, Appointment, Article, Audiologist, Clinic, Region, Service, Topic, User,
} from '../models';
import { requireAdmin, signAdmin, validate } from '../middleware';
import { AppError, badRequest, conflict, notFound } from '../utils/errors';
import { escapeRegex, slugify } from '../utils/text';
import * as auth from '../services/auth';
import { absUrl, htmlToBlocks, readMinutes, sanitizeArticleHtml, toAbsoluteMediaHtml, toRelativeMedia } from '../services/content';
import { saveImage } from '../services/media';
import { importDocument } from '../services/importer';
import { cancelAppointment } from '../services/booking';

export const adminRouter = Router();

const ok = (data: unknown, meta?: object) => ({ data, ...(meta ? { meta } : {}) });
const paging = (q: any, def = 25) => {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || def));
  return { page, limit, skip: (page - 1) * limit };
};
const id = (v: any) => String(v?._id ?? v);
const lt = z.object({ en: z.string().trim().default(''), sw: z.string().trim().default('') }).default({ en: '', sw: '' });
const oid = z.string().refine(isValidObjectId, 'Invalid selection');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use time like 09:00');
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use date like 2026-12-01');

async function uniqueSlug(model: Model<any>, base: string, ignoreId?: string) {
  const root = slugify(base) || 'item';
  let slug = root;
  for (let i = 2; await model.exists({ slug, ...(ignoreId ? { _id: { $ne: ignoreId } } : {}) }); i++) slug = `${root}-${i}`;
  return slug;
}

/* ------------------------------ auth ------------------------------ */
adminRouter.post('/auth/login', validate(z.object({ email: z.string().email(), password: z.string().min(1) })), async (req, res) => {
  const a = await auth.loginAdmin(req.body.email, req.body.password);
  res.json({ token: signAdmin(a.id), admin: { id: a.id, name: a.name, email: a.email } });
});

adminRouter.use(requireAdmin);

adminRouter.get('/auth/me', async (req, res) => {
  const a = await AdminUser.findById(req.adminId);
  if (!a) throw new AppError(401, 'UNAUTHORIZED', 'Please sign in again.');
  res.json(ok({ id: a.id, name: a.name, email: a.email }));
});

adminRouter.post(
  '/auth/change-password',
  validate(z.object({ currentPassword: z.string(), newPassword: z.string().min(8, 'Use at least 8 characters') })),
  async (req, res) => {
    const a = await AdminUser.findById(req.adminId);
    if (!a || !(await bcrypt.compare(req.body.currentPassword, a.passwordHash))) {
      throw badRequest('Your current password is not correct.');
    }
    a.passwordHash = await bcrypt.hash(req.body.newPassword, 10);
    await a.save();
    res.json({ ok: true });
  },
);

adminRouter.get('/admins', async (_req, res) => {
  const items = await AdminUser.find().sort({ createdAt: 1 }).lean();
  res.json(ok(items.map((a) => ({ id: id(a), name: a.name, email: a.email, createdAt: (a as any).createdAt }))));
});
adminRouter.post(
  '/admins',
  validate(z.object({ name: z.string().trim().min(1), email: z.string().email(), password: z.string().min(8, 'Use at least 8 characters') })),
  async (req, res) => {
    if (await AdminUser.exists({ email: req.body.email.toLowerCase() })) throw conflict('VALIDATION_ERROR', 'That email already has an account.');
    const a = await AdminUser.create({
      name: req.body.name, email: req.body.email, passwordHash: await bcrypt.hash(req.body.password, 10),
    });
    res.status(201).json(ok({ id: a.id, name: a.name, email: a.email }));
  },
);
adminRouter.delete('/admins/:id', async (req, res) => {
  if (req.params.id === req.adminId) throw conflict('VALIDATION_ERROR', 'You cannot remove your own account.');
  if ((await AdminUser.countDocuments()) <= 1) throw conflict('VALIDATION_ERROR', 'There must be at least one admin.');
  await AdminUser.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

adminRouter.get('/stats', async (_req, res) => {
  const now = new Date();
  const [audiologists, verifiedAudiologists, clinics, articlesPublished, articlesDraft, upcomingAppointments, patients] =
    await Promise.all([
      Audiologist.countDocuments(),
      Audiologist.countDocuments({ verifiedAt: { $ne: null }, isActive: true }),
      Clinic.countDocuments(),
      Article.countDocuments({ status: 'published' }),
      Article.countDocuments({ status: 'draft' }),
      Appointment.countDocuments({ status: 'confirmed', startAt: { $gte: now } }),
      User.countDocuments({ deletedAt: null }),
    ]);
  res.json(ok({ audiologists, verifiedAudiologists, clinics, articlesPublished, articlesDraft, upcomingAppointments, patients }));
});

/* ------------------------------ generic crud helper ------------------------------ */
interface CrudCfg {
  path: string;
  model: Model<any>;
  schema: z.ZodTypeAny;
  toApi: (d: any) => any;
  toDoc: (body: any, existing?: any) => Promise<Record<string, unknown>> | Record<string, unknown>;
  sort?: Record<string, 1 | -1>;
  populate?: any;
  inUse?: (id: string) => Promise<string | null>;
  after?: (doc: any) => Promise<void>;
}

function crud(c: CrudCfg) {
  adminRouter.get(`/${c.path}`, async (req, res) => {
    const q = c.model.find(c.filter?.(req) ?? {}).sort(c.sort ?? { createdAt: -1 });
    if (c.populate) q.populate(c.populate);
    res.json(ok((await q).map(c.toApi)));
  });
  adminRouter.get(`/${c.path}/:id`, async (req, res) => {
    if (!isValidObjectId(req.params.id)) throw notFound();
    const q = c.model.findById(req.params.id);
    if (c.populate) q.populate(c.populate);
    const d = await q;
    if (!d) throw notFound();
    res.json(ok(c.toApi(d)));
  });
  adminRouter.post(`/${c.path}`, validate(c.schema), async (req, res) => {
    const d = await c.model.create(await c.toDoc(req.body));
    if (c.after) await c.after(d);
    const q = c.model.findById(d._id);
    if (c.populate) q.populate(c.populate);
    res.status(201).json(ok(c.toApi(await q)));
  });
  adminRouter.put(`/${c.path}/:id`, validate(c.schema), async (req, res) => {
    if (!isValidObjectId(req.params.id)) throw notFound();
    const existing = await c.model.findById(req.params.id);
    if (!existing) throw notFound();
    existing.set(await c.toDoc(req.body, existing));
    await existing.save();
    if (c.after) await c.after(existing);
    const q = c.model.findById(existing._id);
    if (c.populate) q.populate(c.populate);
    res.json(ok(c.toApi(await q)));
  });
  adminRouter.delete(`/${c.path}/:id`, async (req, res) => {
    if (!isValidObjectId(req.params.id)) throw notFound();
    const msg = c.inUse ? await c.inUse(req.params.id) : null;
    if (msg) throw conflict('VALIDATION_ERROR', msg);
    await c.model.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  });
}
declare module './admin' {}
type FilterFn = (req: Request) => Record<string, unknown>;
interface CrudCfg { filter?: FilterFn }

/* ------------------------------ regions ------------------------------ */
crud({
  path: 'regions',
  model: Region,
  sort: { sortOrder: 1, name: 1 },
  schema: z.object({ name: z.string().trim().min(1, 'Please enter a name'), sortOrder: z.coerce.number().default(100) }),
  toApi: (d) => ({ id: id(d), name: d.name, slug: d.slug, sortOrder: d.sortOrder }),
  toDoc: async (b, e) => ({ name: b.name, sortOrder: b.sortOrder, slug: e && slugify(e.name) === slugify(b.name) ? e.slug : await uniqueSlug(Region, b.name, e?.id) }),
  inUse: async (rid) => ((await Clinic.exists({ region: rid })) ? 'Some clinics are in this region. Move or delete them first.' : null),
});

/* ------------------------------ services ------------------------------ */
crud({
  path: 'services',
  model: Service,
  sort: { sortOrder: 1, slug: 1 },
  schema: z.object({
    name: lt.refine((n) => n.en || n.sw, 'Please enter a name'),
    description: lt,
    icon: z.string().trim().default('hearing'),
    forChildren: z.boolean().default(false),
    isActive: z.boolean().default(true),
  }),
  toApi: (d) => ({ id: id(d), slug: d.slug, name: d.name, description: d.description, icon: d.icon, forChildren: d.forChildren, isActive: d.isActive }),
  toDoc: async (b, e) => ({ ...b, slug: e?.slug ?? (await uniqueSlug(Service, b.name.en || b.name.sw)) }),
  inUse: async (sid) => ((await Audiologist.exists({ services: sid })) ? 'Some audiologists offer this service. Remove it from them first.' : null),
});

/* ------------------------------ topics ------------------------------ */
crud({
  path: 'topics',
  model: Topic,
  sort: { sortOrder: 1 },
  schema: z.object({
    name: lt.refine((n) => n.en || n.sw, 'Please enter a name'),
    icon: z.string().trim().default('menu_book'),
    sortOrder: z.coerce.number().default(100),
  }),
  toApi: (d) => ({ id: id(d), slug: d.slug, name: d.name, icon: d.icon, sortOrder: d.sortOrder }),
  toDoc: async (b, e) => ({ ...b, slug: e?.slug ?? (await uniqueSlug(Topic, b.name.en || b.name.sw)) }),
  inUse: async (tid) => ((await Article.exists({ topic: tid })) ? 'There are articles in this topic. Move or delete them first.' : null),
});

/* ------------------------------ clinics ------------------------------ */
const clinicToApi = (d: any) => ({
  id: id(d), name: d.name, regionId: id(d.region), regionName: d.region?.name ?? '', district: d.district,
  addressLine: d.addressLine, lat: d.lat, lng: d.lng, phone: d.phone, whatsapp: d.whatsapp,
  acceptsInsurance: d.acceptsInsurance, paymentNote: d.paymentNote,
  openingHours: (d.openingHours ?? []).map((h: any) => ({ label: h.label, hours: h.hours })),
});
crud({
  path: 'clinics',
  model: Clinic,
  sort: { name: 1 },
  populate: { path: 'region', select: 'name' },
  schema: z.object({
    name: z.string().trim().min(1, 'Please enter the clinic name'),
    regionId: oid,
    district: z.string().trim().default(''),
    addressLine: z.string().trim().default(''),
    lat: z.coerce.number().min(-90).max(90).nullable().optional().catch(null),
    lng: z.coerce.number().min(-180).max(180).nullable().optional().catch(null),
    phone: z.string().trim().default(''),
    whatsapp: z.string().trim().default(''),
    acceptsInsurance: z.array(z.string().trim().min(1)).default([]),
    paymentNote: z.string().trim().default(''),
    openingHours: z.array(z.object({ label: z.string().trim(), hours: z.string().trim() })).default([]),
  }),
  toApi: clinicToApi,
  toDoc: (b) => ({ ...b, region: b.regionId, lat: b.lat ?? null, lng: b.lng ?? null }),
  inUse: async (cid) => ((await Audiologist.exists({ clinic: cid })) ? 'Audiologists work at this clinic. Move or delete them first.' : null),
  // keep denormalised audiologist fields in sync
  after: async (c) => {
    await Audiologist.updateMany({ clinic: c._id }, { region: c.region, clinicName: c.name, insurance: c.acceptsInsurance });
  },
});

/* ------------------------------ audiologists ------------------------------ */
const audSchema = z.object({
  name: z.string().trim().min(1, 'Please enter the name'),
  title: z.string().trim().default('Audiologist'),
  photoUrl: z.string().nullable().optional(),
  bio: lt,
  clinicId: oid,
  serviceIds: z.array(oid).default([]),
  languages: z.array(z.enum(['en', 'sw'])).default(['en', 'sw']),
  gender: z.enum(['female', 'male', 'unspecified']).default('unspecified'),
  yearsExperience: z.coerce.number().int().min(0).max(70).default(0),
  registrationNumber: z.string().trim().default(''),
  verified: z.boolean().default(false),
  contactPhone: z.string().trim().default(''),
  slotMinutes: z.coerce.number().int().min(15).max(120).default(60),
  leadTimeHours: z.coerce.number().min(0).max(168).default(2),
  maxDaysAhead: z.coerce.number().int().min(1).max(180).default(30),
  weeklyHours: z
    .array(z.object({ dayOfWeek: z.coerce.number().int().min(0).max(6), start: hhmm, end: hhmm }))
    .default([])
    .refine((a) => a.every((w) => w.start < w.end), 'Each opening time must be before its closing time'),
  timeOff: z
    .array(z.object({ from: ymd, to: ymd, reason: z.string().default('') }))
    .default([])
    .refine((a) => a.every((t) => t.from <= t.to), 'Days off: "from" must not be after "to"'),
  isActive: z.boolean().default(true),
});

const audToApi = (d: any) => ({
  id: id(d), name: d.name, title: d.title, photoUrl: absUrl(d.photoUrl), bio: d.bio,
  clinicId: id(d.clinic), clinicName: d.clinic?.name ?? d.clinicName, regionId: id(d.region),
  regionName: d.region?.name ?? '',
  serviceIds: (d.services ?? []).map(id), serviceNames: (d.services ?? []).map((s: any) => s.name?.en || s.name?.sw).filter(Boolean),
  languages: d.languages, gender: d.gender, yearsExperience: d.yearsExperience,
  registrationNumber: d.registrationNumber, verified: !!d.verifiedAt, contactPhone: d.contactPhone,
  slotMinutes: d.slotMinutes, leadTimeHours: d.leadTimeHours, maxDaysAhead: d.maxDaysAhead,
  weeklyHours: (d.weeklyHours ?? []).map((w: any) => ({ dayOfWeek: w.dayOfWeek, start: w.start, end: w.end })),
  timeOff: (d.timeOff ?? []).map((t: any) => ({ from: t.from, to: t.to, reason: t.reason })),
  isActive: d.isActive,
});

crud({
  path: 'audiologists',
  model: Audiologist,
  sort: { name: 1 },
  populate: [{ path: 'clinic', select: 'name' }, { path: 'region', select: 'name' }, { path: 'services', select: 'name' }],
  schema: audSchema,
  toApi: audToApi,
  toDoc: async (b, e) => {
    const clinic = await Clinic.findById(b.clinicId);
    if (!clinic) throw badRequest('Please choose a clinic.');
    const photoUrl = b.photoUrl ? toRelativeMedia(b.photoUrl) : null;
    const { clinicId, serviceIds, verified, ...rest } = b;
    return {
      ...rest,
      photoUrl,
      clinic: clinic._id,
      region: clinic.region,
      clinicName: clinic.name,
      insurance: clinic.acceptsInsurance,
      services: serviceIds,
      verifiedAt: verified ? (e?.verifiedAt ?? new Date()) : null,
    };
  },
  inUse: async (aid) =>
    (await Appointment.exists({ audiologist: aid, status: 'confirmed', startAt: { $gte: new Date() } }))
      ? 'This audiologist has upcoming appointments. Cancel them first, or switch the audiologist to "Not active" instead of deleting.'
      : null,
});

/* ------------------------------ articles ------------------------------ */
const articleSchema = z.object({
  topicId: oid,
  tag: z.enum(['care-guide', 'prevention', 'devices', 'children', 'general']).default('general'),
  isFeatured: z.boolean().default(false),
  heroImageUrl: z.string().nullable().optional(),
  reviewedBy: z.object({ name: z.string().trim().default(''), credential: z.string().trim().default('') }).nullable().optional(),
  title: lt,
  summary: lt,
  bodyHtml: lt,
});

function buildContent(b: any, lang: 'en' | 'sw') {
  const html = sanitizeArticleHtml(b.bodyHtml[lang] ?? '');
  return {
    title: b.title[lang] ?? '',
    summary: (b.summary[lang] ?? '').slice(0, 300),
    bodyHtml: html,
    blocks: htmlToBlocks(html),
    readMinutes: readMinutes(html),
  };
}

const articleToApi = (a: any) => ({
  id: id(a), topicId: id(a.topic), topicName: a.topic?.name?.en ?? '', status: a.status, tag: a.tag,
  isFeatured: a.isFeatured, heroImageUrl: absUrl(a.heroImageUrl), readMinutes: a.content?.en?.readMinutes ?? a.content?.sw?.readMinutes ?? 1,
  title: { en: a.content?.en?.title ?? '', sw: a.content?.sw?.title ?? '' },
  summary: { en: a.content?.en?.summary ?? '', sw: a.content?.sw?.summary ?? '' },
  hasSwahili: !!(a.content?.sw?.title && a.content?.sw?.bodyHtml),
  reviewedBy: a.reviewedBy?.name ? { name: a.reviewedBy.name, credential: a.reviewedBy.credential ?? '' } : { name: '', credential: '' },
  updatedAt: a.updatedAt, publishedAt: a.publishedAt,
});
const articleFull = (a: any) => ({
  ...articleToApi(a),
  bodyHtml: {
    en: toAbsoluteMediaHtml(a.content?.en?.bodyHtml ?? ''),
    sw: toAbsoluteMediaHtml(a.content?.sw?.bodyHtml ?? ''),
  },
});

adminRouter.get('/articles', async (req, res) => {
  const q = req.query as Record<string, string>;
  const filter: Record<string, any> = {};
  if (q.status === 'draft' || q.status === 'published') filter.status = q.status;
  if (q.topicId && isValidObjectId(q.topicId)) filter.topic = q.topicId;
  if (q.q?.trim()) {
    const rx = new RegExp(escapeRegex(q.q.trim()), 'i');
    filter.$or = [{ 'content.en.title': rx }, { 'content.sw.title': rx }];
  }
  const { page, limit, skip } = paging(q);
  const [items, total] = await Promise.all([
    Article.find(filter, { 'content.en.bodyHtml': 0, 'content.sw.bodyHtml': 0, 'content.en.blocks': 0, 'content.sw.blocks': 0 })
      .sort({ updatedAt: -1 }).skip(skip).limit(limit).populate('topic', 'name'),
    Article.countDocuments(filter),
  ]);
  res.json(ok(items.map(articleToApi), { page, limit, total }));
});

adminRouter.post('/articles', validate(articleSchema), async (req, res) => {
  const b = req.body;
  if (!(await Topic.exists({ _id: b.topicId }))) throw badRequest('Please choose a topic.');
  if (!b.title.en.trim() && !b.title.sw.trim()) throw badRequest('Please enter a title.');
  const a = await Article.create({
    slug: await uniqueSlug(Article, b.title.en || b.title.sw),
    topic: b.topicId, tag: b.tag, isFeatured: b.isFeatured,
    heroImageUrl: b.heroImageUrl ? toRelativeMedia(b.heroImageUrl) : null,
    reviewedBy: b.reviewedBy?.name ? b.reviewedBy : null,
    status: 'draft',
    content: { en: buildContent(b, 'en'), sw: buildContent(b, 'sw') },
  });
  res.status(201).json(ok(articleFull(await a.populate('topic', 'name'))));
});

adminRouter.get('/articles/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw notFound();
  const a = await Article.findById(req.params.id).populate('topic', 'name');
  if (!a) throw notFound();
  res.json(ok(articleFull(a)));
});

adminRouter.put('/articles/:id', validate(articleSchema), async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw notFound();
  const a = await Article.findById(req.params.id);
  if (!a) throw notFound();
  const b = req.body;
  if (!(await Topic.exists({ _id: b.topicId }))) throw badRequest('Please choose a topic.');
  if (a.status === 'published' && !(b.title.en.trim() && sanitizeArticleHtml(b.bodyHtml.en))) {
    throw badRequest('A published article needs an English title and text. Save it as a draft instead, or fill them in.');
  }
  a.set({
    topic: b.topicId, tag: b.tag, isFeatured: b.isFeatured,
    heroImageUrl: b.heroImageUrl ? toRelativeMedia(b.heroImageUrl) : null,
    reviewedBy: b.reviewedBy?.name ? b.reviewedBy : null,
    content: { en: buildContent(b, 'en'), sw: buildContent(b, 'sw') },
  });
  await a.save();
  res.json(ok(articleFull(await a.populate('topic', 'name'))));
});

adminRouter.post('/articles/:id/publish', async (req, res) => {
  const a = await Article.findById(req.params.id);
  if (!a) throw notFound();
  if (!a.content?.en?.title?.trim() || !a.content?.en?.bodyHtml?.trim()) {
    throw badRequest('Please add an English title and some text before publishing.');
  }
  a.status = 'published';
  a.publishedAt = a.publishedAt ?? new Date();
  await a.save();
  res.json(ok(articleFull(await a.populate('topic', 'name'))));
});
adminRouter.post('/articles/:id/unpublish', async (req, res) => {
  const a = await Article.findById(req.params.id);
  if (!a) throw notFound();
  a.status = 'draft';
  await a.save();
  res.json(ok(articleFull(await a.populate('topic', 'name'))));
});
adminRouter.delete('/articles/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw notFound();
  await Article.deleteOne({ _id: req.params.id });
  await User.updateMany({}, { $pull: { savedArticles: req.params.id } });
  res.json({ ok: true });
});

/* ------------------------------ uploads ------------------------------ */
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_r, f, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(f.mimetype)),
});
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

adminRouter.post('/media', imageUpload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Please choose a picture (JPG, PNG or WebP).');
  res.status(201).json(await saveImage(req.file.buffer, req.file.originalname));
});

adminRouter.post('/articles/import', docUpload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Please choose a file to upload.');
  const r = await importDocument({ originalname: req.file.originalname, buffer: req.file.buffer });
  res.json({ ...r, html: toAbsoluteMediaHtml(r.html) });
});

/* ------------------------------ appointments & patients ------------------------------ */
adminRouter.get('/appointments', async (req, res) => {
  const q = req.query as Record<string, string>;
  const filter: Record<string, any> = {};
  if (['confirmed', 'cancelled', 'completed', 'no_show'].includes(q.status)) filter.status = q.status;
  if (q.audiologistId && isValidObjectId(q.audiologistId)) filter.audiologist = q.audiologistId;
  if (q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date)) {
    const start = new Date(Date.parse(q.date + 'T00:00:00Z') - 3 * 3600_000);
    filter.startAt = { $gte: start, $lt: new Date(start.getTime() + 86_400_000) };
  }
  const { page, limit, skip } = paging(q);
  const [items, total] = await Promise.all([
    Appointment.find(filter).sort({ startAt: q.status === 'confirmed' || q.date ? 1 : -1 }).skip(skip).limit(limit).populate('patient', 'name phone'),
    Appointment.countDocuments(filter),
  ]);
  res.json(
    ok(
      items.map((a: any) => ({
        id: id(a), status: a.status, startAt: a.startAt.toISOString(),
        patient: { name: a.patient?.name ?? '', phone: a.patient?.phone ?? '' },
        audiologistName: a.snap?.audiologistName, clinicName: a.snap?.clinicName,
        serviceName: a.snap?.serviceName?.en, bookedFor: a.bookedFor, note: a.note,
      })),
      { page, limit, total },
    ),
  );
});

async function apptById(req: Request) {
  if (!isValidObjectId(req.params.id)) throw notFound();
  const a = await Appointment.findById(req.params.id);
  if (!a) throw notFound();
  return a;
}
adminRouter.post('/appointments/:id/cancel', validate(z.object({ reason: z.string().max(200).optional() })), async (req, res) => {
  await cancelAppointment(await apptById(req), 'clinic', req.body.reason);
  res.json({ ok: true });
});
for (const [path, status] of [['complete', 'completed'], ['no-show', 'no_show']] as const) {
  adminRouter.post(`/appointments/:id/${path}`, async (req, res) => {
    const a = await apptById(req);
    if (a.status !== 'confirmed') throw conflict('VALIDATION_ERROR', 'Only confirmed appointments can be updated.');
    a.status = status;
    await a.save();
    res.json({ ok: true });
  });
}

adminRouter.get('/patients', async (req, res) => {
  const q = req.query as Record<string, string>;
  const filter: Record<string, any> = { deletedAt: null };
  if (q.q?.trim()) {
    const rx = new RegExp(escapeRegex(q.q.trim()), 'i');
    filter.$or = [{ name: rx }, { phone: rx }];
  }
  const { page, limit, skip } = paging(q);
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('region', 'name').lean(),
    User.countDocuments(filter),
  ]);
  const counts = await Appointment.aggregate([
    { $match: { patient: { $in: items.map((u) => u._id) } } },
    { $group: { _id: '$patient', n: { $sum: 1 } } },
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json(
    ok(
      items.map((u: any) => ({
        id: id(u), name: u.name, phone: u.phone, regionName: u.region?.name ?? '',
        createdAt: u.createdAt, appointmentCount: map.get(id(u)) ?? 0,
      })),
      { page, limit, total },
    ),
  );
});
