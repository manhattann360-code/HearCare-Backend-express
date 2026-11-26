import { Router } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import {
  Appointment, Article, Audiologist, Notification, Region, RefreshToken, Service, Topic, User,
} from '../models';
import { optionalUser, requireUser, validate } from '../middleware';
import { AppError, badRequest, notFound } from '../utils/errors';
import { escapeRegex, loc, normalizePhone, reqLang } from '../utils/text';
import { addDays, eatDateString, isDateString, daysBetween, slotLabel } from '../utils/time';
import * as auth from '../services/auth';
import { freeSlotsByDate, slotDto } from '../services/slots';
import {
  cancelAppointment, createAppointment, rescheduleAppointment,
} from '../services/booking';
import {
  appointmentDto, articleDetail, articleSummary, audiologistDetail, audiologistSummary,
} from '../services/dto';
import { streamImage } from '../services/media';

export const publicRouter = Router();
export const mediaRouter = Router();

const ok = (data: unknown, meta?: object) => ({ data, ...(meta ? { meta } : {}) });
const page = (q: any) => {
  const p = Math.max(1, Number(q.page) || 1);
  const l = Math.min(50, Math.max(1, Number(q.limit) || 20));
  return { page: p, limit: l, skip: (p - 1) * l };
};

/* ------------------------------ config ------------------------------ */
publicRouter.get('/config', (_req, res) => {
  res.json({
    minAppVersion: config.MIN_APP_VERSION,
    maintenance: { enabled: config.MAINTENANCE_MODE, message: config.MAINTENANCE_MESSAGE },
    supportPhone: config.SUPPORT_PHONE,
    supportWhatsapp: config.SUPPORT_WHATSAPP,
  });
});

const TIPS = [
  { en: 'Keep cotton swabs out of your ear canal. Clean only the outer ear gently with a damp cloth.', sw: 'Usitumie vijiti vya pamba ndani ya sikio. Safisha sehemu ya nje ya sikio tu kwa kitambaa chenye unyevu.' },
  { en: 'Keep headphone volume under 60% and take a listening break every hour.', sw: 'Weka sauti ya vipokea sauti chini ya 60% na pumzisha masikio kila saa.' },
  { en: 'Wear ear protection at loud events, workshops and construction sites.', sw: 'Vaa kinga ya masikio kwenye matukio yenye kelele, karakana na maeneo ya ujenzi.' },
  { en: 'If a child does not respond to sounds or is slow to speak, ask for a hearing check.', sw: 'Mtoto asipoitikia sauti au akichelewa kuongea, mpeleke apimwe kusikia.' },
  { en: 'Sudden hearing loss in one ear is urgent. See a health professional the same day.', sw: 'Kupoteza kusikia ghafla kwenye sikio moja ni dharura. Muone mtaalamu wa afya siku hiyo hiyo.' },
  { en: 'Dry your ears gently after swimming or bathing to help prevent infections.', sw: 'Kausha masikio taratibu baada ya kuogelea au kuoga ili kuepuka maambukizi.' },
  { en: 'Adults over 50 should have their hearing checked every few years.', sw: 'Watu wazima zaidi ya miaka 50 wanapaswa kupima kusikia kila baada ya miaka michache.' },
];

publicRouter.get('/tips/today', (req, res) => {
  const lang = reqLang(req);
  const day = Math.floor(Date.now() / 86_400_000);
  const tip = TIPS[day % TIPS.length];
  res.json(ok({ text: tip[lang], articleSlug: null }));
});

/* ------------------------------ auth ------------------------------ */
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: config.NODE_ENV === 'test' ? 1000 : 30, standardHeaders: true, legacyHeaders: false });

publicRouter.post(
  '/auth/request-otp',
  authLimiter,
  validate(z.object({ phone: z.string().min(9).max(20) })),
  async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    if (!phone) throw badRequest('Please enter a valid Tanzanian phone number, e.g. 0712 345 678.');
    res.json(await auth.requestOtp(phone));
  },
);

publicRouter.post(
  '/auth/verify-otp',
  authLimiter,
  validate(z.object({ phone: z.string(), code: z.string().regex(/^\d{4,8}$/, 'Enter the numeric code') })),
  async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    if (!phone) throw badRequest('Invalid phone number.');
    res.json(await auth.verifyOtp(phone, req.body.code));
  },
);

publicRouter.post('/auth/refresh', validate(z.object({ refreshToken: z.string() })), async (req, res) => {
  res.json(await auth.rotateRefresh(req.body.refreshToken));
});

publicRouter.post('/auth/logout', validate(z.object({ refreshToken: z.string() })), async (req, res) => {
  await auth.revokeRefresh(req.body.refreshToken);
  res.json({ ok: true });
});

/* ------------------------------ me ------------------------------ */
publicRouter.get('/me', requireUser, async (req, res) => {
  res.json(ok(await auth.userDto(req.userId!)));
});

publicRouter.patch(
  '/me',
  requireUser,
  validate(
    z.object({
      name: z.string().trim().max(80).optional(),
      regionId: z.string().nullable().optional(),
      language: z.enum(['en', 'sw']).optional(),
      remindersEnabled: z.boolean().optional(),
    }),
  ),
  async (req, res) => {
    const { name, regionId, language, remindersEnabled } = req.body;
    const upd: Record<string, unknown> = {};
    if (name !== undefined) upd.name = name;
    if (language) upd.language = language;
    if (remindersEnabled !== undefined) upd.remindersEnabled = remindersEnabled;
    if (regionId !== undefined) {
      if (regionId && !(isValidObjectId(regionId) && (await Region.exists({ _id: regionId })))) {
        throw badRequest('Unknown region.');
      }
      upd.region = regionId || null;
    }
    await User.updateOne({ _id: req.userId }, upd);
    res.json(ok(await auth.userDto(req.userId!)));
  },
);

publicRouter.delete('/me', requireUser, async (req, res) => {
  const now = new Date();
  const upcoming = await Appointment.find({ patient: req.userId, status: 'confirmed', startAt: { $gte: now } });
  for (const a of upcoming) {
    a.status = 'cancelled';
    a.cancelledBy = 'patient';
    a.cancelReason = 'Account deleted';
    await a.save();
  }
  await Promise.all([
    RefreshToken.deleteMany({ user: req.userId }),
    Notification.deleteMany({ user: req.userId }),
    User.updateOne(
      { _id: req.userId },
      { name: 'Deleted user', phone: `deleted:${req.userId}`, pushTokens: [], savedArticles: [], deletedAt: now },
    ),
  ]);
  res.json({ ok: true });
});

publicRouter.post('/me/push-token', requireUser, validate(z.object({ token: z.string().min(10) })), async (req, res) => {
  await User.updateOne({ _id: req.userId }, { $addToSet: { pushTokens: req.body.token } });
  res.json({ ok: true });
});

publicRouter.get('/me/notifications', requireUser, async (req, res) => {
  const items = await Notification.find({ user: req.userId }).sort({ createdAt: -1 }).limit(100).lean();
  const unread = items.filter((n) => !n.readAt).length;
  res.json(
    ok(
      items.map((n) => ({
        id: String(n._id), type: n.type, title: n.title, body: n.body, data: n.data,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: (n as any).createdAt.toISOString(),
      })),
      { unread },
    ),
  );
});

publicRouter.post('/me/notifications/read-all', requireUser, async (req, res) => {
  await Notification.updateMany({ user: req.userId, readAt: null }, { readAt: new Date() });
  res.json({ ok: true });
});

publicRouter.post('/me/notifications/:id/read', requireUser, async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, user: req.userId }, { readAt: new Date() });
  res.json({ ok: true });
});

publicRouter.get('/me/saved-articles', requireUser, async (req, res) => {
  const lang = reqLang(req);
  const u = await User.findById(req.userId).populate({
    path: 'savedArticles',
    match: { status: 'published' },
    populate: { path: 'topic' },
  });
  res.json(ok((u?.savedArticles ?? []).map((a: any) => articleSummary(a, lang))));
});

publicRouter.put('/me/saved-articles/:articleId', requireUser, async (req, res) => {
  const a = await Article.findOne({ _id: req.params.articleId, status: 'published' }, { _id: 1 });
  if (!a) throw notFound();
  await User.updateOne({ _id: req.userId }, { $addToSet: { savedArticles: a._id } });
  res.json({ ok: true });
});

publicRouter.delete('/me/saved-articles/:articleId', requireUser, async (req, res) => {
  await User.updateOne({ _id: req.userId }, { $pull: { savedArticles: req.params.articleId } });
  res.json({ ok: true });
});

/* ------------------------------ catalog ------------------------------ */
publicRouter.get('/regions', async (_req, res) => {
  const [regions, counts] = await Promise.all([
    Region.find().sort({ sortOrder: 1, name: 1 }).lean(),
    Audiologist.aggregate([
      { $match: { isActive: true, verifiedAt: { $ne: null } } },
      { $group: { _id: '$region', n: { $sum: 1 } } },
    ]),
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json(ok(regions.map((r) => ({ id: String(r._id), name: r.name, slug: r.slug, audiologistCount: map.get(String(r._id)) ?? 0 }))));
});

publicRouter.get('/services', async (req, res) => {
  const lang = reqLang(req);
  const items = await Service.find({ isActive: true }).sort({ sortOrder: 1, slug: 1 }).lean();
  res.json(
    ok(items.map((s) => ({
      id: String(s._id), slug: s.slug, name: loc(s.name, lang), description: loc(s.description, lang),
      icon: s.icon, forChildren: s.forChildren,
    }))),
  );
});

/* ------------------------------ audiologists ------------------------------ */
async function resolveId(model: any, v: unknown): Promise<string | null | undefined> {
  if (!v) return undefined;
  const s = String(v);
  if (isValidObjectId(s)) return s;
  const doc = await model.findOne({ slug: s }, { _id: 1 }).lean();
  return doc ? String(doc._id) : null;
}

const populateAud = [
  { path: 'clinic', populate: { path: 'region', select: 'name' } },
  { path: 'services', select: 'name' },
];

publicRouter.get('/audiologists', async (req, res) => {
  const lang = reqLang(req);
  const q = req.query as Record<string, string>;
  const filter: Record<string, any> = { isActive: true, verifiedAt: { $ne: null } };

  const regionId = await resolveId(Region, q.region);
  if (regionId === null) return res.json(ok([], { page: 1, limit: 20, total: 0 }));
  if (regionId) filter.region = regionId;
  const serviceId = await resolveId(Service, q.service);
  if (serviceId === null) return res.json(ok([], { page: 1, limit: 20, total: 0 }));
  if (serviceId) filter.services = serviceId;
  if (q.insurance) filter.insurance = { $regex: `^${escapeRegex(q.insurance)}$`, $options: 'i' };
  if (q.language === 'en' || q.language === 'sw') filter.languages = q.language;
  if (q.gender === 'female' || q.gender === 'male') filter.gender = q.gender;
  if (q.q?.trim()) {
    const rx = new RegExp(escapeRegex(q.q.trim()), 'i');
    filter.$or = [{ name: rx }, { clinicName: rx }];
  }

  const { page: p, limit, skip } = page(q);
  const sort = { name: 1 } as const;

  if (q.availability === 'today' || q.availability === 'tomorrow' || q.availability === 'week') {
    const all = await Audiologist.find(filter).sort(sort).limit(200).populate(populateAud);
    const now = new Date();
    const today = eatDateString(now);
    const days = q.availability === 'today' ? 0 : q.availability === 'tomorrow' ? 1 : 7;
    const from = q.availability === 'tomorrow' ? addDays(today, 1) : today;
    const to = addDays(today, days);
    const keep: any[] = [];
    for (const a of all) {
      const by = await freeSlotsByDate(a as any, from, to, now);
      if (Object.values(by).some((s) => s.length)) keep.push(a);
    }
    const slice = keep.slice(skip, skip + limit);
    const data = await Promise.all(slice.map((a) => audiologistSummary(a, lang)));
    return res.json(ok(data, { page: p, limit, total: keep.length }));
  }

  const [items, total] = await Promise.all([
    Audiologist.find(filter).sort(sort).skip(skip).limit(limit).populate(populateAud),
    Audiologist.countDocuments(filter),
  ]);
  const data = await Promise.all(items.map((a) => audiologistSummary(a, lang)));
  res.json(ok(data, { page: p, limit, total }));
});

async function loadAudiologist(id: string) {
  if (!isValidObjectId(id)) throw notFound();
  const a = await Audiologist.findOne({ _id: id, isActive: true, verifiedAt: { $ne: null } }).populate(populateAud);
  if (!a) throw notFound('This audiologist is not available.');
  return a;
}

publicRouter.get('/audiologists/:id', async (req, res) => {
  res.json(ok(await audiologistDetail(await loadAudiologist(req.params.id), reqLang(req))));
});

publicRouter.get('/audiologists/:id/availability', async (req, res) => {
  const a = await loadAudiologist(req.params.id);
  const today = eatDateString(new Date());
  const from = String(req.query.from ?? today);
  const to = String(req.query.to ?? addDays(from, 13));
  if (!isDateString(from) || !isDateString(to) || daysBetween(from, to) < 0 || daysBetween(from, to) > 31) {
    throw badRequest('Use dates like 2026-12-01 (max 31 days).');
  }
  const by = await freeSlotsByDate(a as any, from, to);
  res.json(ok(Object.keys(by).sort().map((date) => ({ date, slots: by[date].length }))));
});

publicRouter.get('/audiologists/:id/slots', async (req, res) => {
  const a = await loadAudiologist(req.params.id);
  const date = String(req.query.date ?? '');
  if (!isDateString(date)) throw badRequest('Please provide ?date=YYYY-MM-DD');
  const by = await freeSlotsByDate(a as any, date, date);
  res.json(ok((by[date] ?? []).map(slotDto)));
});

/* ------------------------------ appointments ------------------------------ */
const bookSchema = z.object({
  audiologistId: z.string(),
  serviceId: z.string(),
  startAt: z.coerce.date(),
  bookedFor: z
    .object({
      type: z.enum(['self', 'child', 'other']).default('self'),
      name: z.string().trim().max(80).optional(),
      ageYears: z.number().int().min(0).max(120).nullable().optional(),
    })
    .optional(),
  note: z.string().max(300).optional(),
  remindersEnabled: z.boolean().optional(),
});

const apptPopulate = [{ path: 'audiologist', select: 'name photoUrl' }];

publicRouter.post('/appointments', requireUser, validate(bookSchema), async (req, res) => {
  const lang = reqLang(req);
  const key = req.header('Idempotency-Key') || undefined;
  const appt = await createAppointment(req.userId!, { ...req.body, idempotencyKey: key }, lang);
  res.status(201).json(ok(appointmentDto(await appt.populate(apptPopulate), lang)));
});

publicRouter.get('/appointments', requireUser, async (req, res) => {
  const lang = reqLang(req);
  const now = new Date();
  const upcoming = req.query.scope !== 'past';
  const filter = upcoming
    ? { patient: req.userId, status: 'confirmed', startAt: { $gte: now } }
    : { patient: req.userId, $or: [{ status: { $ne: 'confirmed' } }, { startAt: { $lt: now } }] };
  const items = await Appointment.find(filter).sort({ startAt: upcoming ? 1 : -1 }).limit(100).populate(apptPopulate);
  res.json(ok(items.map((a) => appointmentDto(a, lang))));
});

async function myAppointment(req: any) {
  if (!isValidObjectId(req.params.id)) throw notFound();
  const a = await Appointment.findOne({ _id: req.params.id, patient: req.userId }).populate(apptPopulate);
  if (!a) throw notFound('Appointment not found.');
  return a;
}

publicRouter.get('/appointments/:id', requireUser, async (req, res) => {
  res.json(ok(appointmentDto(await myAppointment(req), reqLang(req))));
});

publicRouter.post('/appointments/:id/cancel', requireUser, validate(z.object({ reason: z.string().max(200).optional() })), async (req, res) => {
  const a = await cancelAppointment(await myAppointment(req), 'patient', req.body.reason);
  res.json(ok(appointmentDto(a, reqLang(req))));
});

publicRouter.post('/appointments/:id/reschedule', requireUser, validate(z.object({ startAt: z.coerce.date() })), async (req, res) => {
  const lang = reqLang(req);
  const created = await rescheduleAppointment(await myAppointment(req), req.body.startAt, lang);
  res.json(ok(appointmentDto(await created.populate(apptPopulate), lang)));
});

/* ------------------------------ education ------------------------------ */
publicRouter.get('/topics', async (req, res) => {
  const lang = reqLang(req);
  const [topics, counts] = await Promise.all([
    Topic.find().sort({ sortOrder: 1 }).lean(),
    Article.aggregate([{ $match: { status: 'published' } }, { $group: { _id: '$topic', n: { $sum: 1 } } }]),
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json(ok(topics.map((t) => ({
    id: String(t._id), slug: t.slug, name: loc(t.name, lang), icon: t.icon, articleCount: map.get(String(t._id)) ?? 0,
  }))));
});

publicRouter.get('/articles', optionalUser, async (req, res) => {
  const lang = reqLang(req);
  const q = req.query as Record<string, string>;
  const filter: Record<string, any> = { status: 'published' };
  const topicId = await resolveId(Topic, q.topic);
  if (topicId === null) return res.json(ok([], { page: 1, limit: 20, total: 0 }));
  if (topicId) filter.topic = topicId;
  if (q.featured === 'true') filter.isFeatured = true;
  if (q.tag) filter.tag = q.tag;
  if (q.q?.trim()) {
    const rx = new RegExp(escapeRegex(q.q.trim()), 'i');
    filter.$or = [
      { 'content.en.title': rx }, { 'content.sw.title': rx },
      { 'content.en.summary': rx }, { 'content.sw.summary': rx },
      { 'content.en.bodyHtml': rx }, { 'content.sw.bodyHtml': rx },
    ];
  }
  const { page: p, limit, skip } = page(q);
  const [items, total] = await Promise.all([
    Article.find(filter, { 'content.en.bodyHtml': 0, 'content.sw.bodyHtml': 0, 'content.en.blocks': 0, 'content.sw.blocks': 0 })
      .sort({ isFeatured: -1, publishedAt: -1 }).skip(skip).limit(limit).populate('topic'),
    Article.countDocuments(filter),
  ]);
  res.json(ok(items.map((a) => articleSummary(a, lang)), { page: p, limit, total }));
});

publicRouter.get('/articles/:slugOrId', async (req, res) => {
  const key = req.params.slugOrId;
  const a = await Article.findOne({
    status: 'published',
    ...(isValidObjectId(key) ? { _id: key } : { slug: key }),
  }).populate('topic');
  if (!a) throw notFound('Article not found.');
  res.json(ok(articleDetail(a, reqLang(req))));
});

/* ------------------------------ media ------------------------------ */
mediaRouter.get('/:id', async (req, res) => {
  const f = await streamImage(req.params.id);
  if (!f) return res.status(404).end();
  res.set({
    'Content-Type': 'image/webp',
    'Content-Length': String(f.length),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  f.stream.pipe(res);
});

void AppError;
