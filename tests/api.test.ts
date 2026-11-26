import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { connectDb, disconnectDb } from '../src/db';
import { createApp } from '../src/app';
import { seedDemo } from '../src/seeds/data';
import { Appointment, Audiologist, Notification, Region, Service, Topic, User } from '../src/models';
import { addDays, eatDateString, MS } from '../src/utils/time';
import { runRemindersOnce } from '../src/jobs/reminders';

const app = createApp();

// 1x1 transparent PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function loginPatient(phone: string) {
  const r1 = await request(app).post('/api/v1/auth/request-otp').send({ phone });
  expect(r1.status).toBe(200);
  const code = r1.body.devCode as string;
  expect(code).toMatch(/^\d{6}$/);
  const r2 = await request(app).post('/api/v1/auth/verify-otp').send({ phone, code });
  expect(r2.status).toBe(200);
  return r2.body as { accessToken: string; refreshToken: string; user: any; isNewUser: boolean };
}

describe('HearCare Backend API', () => {
  beforeAll(async () => {
    await connectDb('memory');
    await seedDemo();
  }, 120_000);

  afterAll(async () => {
    await disconnectDb();
  });

  it('serves health, config, regions, services and topics', async () => {
    const h = await request(app).get('/health');
    expect(h.status).toBe(200);
    expect(h.body.ok).toBe(true);

    const [cfg, reg, svc, top] = await Promise.all([
      request(app).get('/api/v1/config'),
      request(app).get('/api/v1/regions'),
      request(app).get('/api/v1/services?lang=sw'),
      request(app).get('/api/v1/topics?lang=en'),
    ]);
    expect(cfg.status).toBe(200);
    expect(reg.body.data.length).toBeGreaterThanOrEqual(7);
    expect(svc.body.data.length).toBeGreaterThanOrEqual(6);
    expect(svc.body.data[0].name).toBeTruthy();
    expect(top.body.data.length).toBe(8);
  });

  it('filters audiologists and generates slots respecting weeklyHours and timeOff', async () => {
    const dar = await Region.findOne({ slug: 'dar-es-salaam' });
    const list = await request(app).get(`/api/v1/audiologists?region=${dar!.id}`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(3);

    const audId = list.body.data[0].id;
    const detail = await request(app).get(`/api/v1/audiologists/${audId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.clinic.name).toBeTruthy();

    // Find next Monday within 10 days
    let monday = addDays(eatDateString(new Date()), 2);
    for (let i = 0; i < 8; i++) {
      const candidate = addDays(eatDateString(new Date()), 1 + i);
      if (new Date(candidate + 'T00:00:00Z').getUTCDay() === 1) {
        monday = candidate;
        break;
      }
    }

    const slots = await request(app).get(`/api/v1/audiologists/${audId}/slots?date=${monday}`);
    expect(slots.status).toBe(200);
    expect(slots.body.data.length).toBeGreaterThan(0);

    // Put audiologist on timeOff for that Monday and verify 0 slots
    await Audiologist.updateOne({ _id: audId }, { $push: { timeOff: { from: monday, to: monday, reason: 'Leave' } } });
    const offSlots = await request(app).get(`/api/v1/audiologists/${audId}/slots?date=${monday}`);
    expect(offSlots.body.data).toEqual([]);
    await Audiologist.updateOne({ _id: audId }, { $set: { timeOff: [] } });
  });

  it('authenticates via OTP, rotates refresh token, and updates /me', async () => {
    const auth = await loginPatient('0712345678');
    expect(auth.isNewUser).toBe(true);
    expect(auth.user.phone).toBe('+255712345678');

    const patch = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .send({ name: 'Juma Ally', language: 'sw' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.name).toBe('Juma Ally');
    expect(patch.body.data.initials).toBe('JA');

    const ref = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: auth.refreshToken });
    expect(ref.status).toBe(200);
    expect(ref.body.accessToken).toBeTruthy();
    expect(ref.body.refreshToken).not.toBe(auth.refreshToken);

    // Old refresh token was rotated and must fail
    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: auth.refreshToken });
    expect(reuse.status).toBe(401);
  });

  it('prevents concurrent double-booking, supports idempotency, cancel policy, reschedule and ownership', async () => {
    const aud = await Audiologist.findOne({ isActive: true, verifiedAt: { $ne: null } });
    const serviceId = String(aud!.services[0]);

    // Pick a future weekday at least 3 days out
    let targetDate = addDays(eatDateString(new Date()), 3);
    for (let i = 0; i < 7; i++) {
      const d = addDays(eatDateString(new Date()), 3 + i);
      const dow = new Date(d + 'T00:00:00Z').getUTCDay();
      if (dow >= 1 && dow <= 5) {
        targetDate = d;
        break;
      }
    }
    const slotsRes = await request(app).get(`/api/v1/audiologists/${aud!.id}/slots?date=${targetDate}`);
    const slotA = slotsRes.body.data[0].startAt;
    const slotB = slotsRes.body.data[1].startAt;

    const users = await Promise.all([
      loginPatient('0711000001'),
      loginPatient('0711000002'),
      loginPatient('0711000003'),
      loginPatient('0711000004'),
      loginPatient('0711000005'),
    ]);

    // Fire 5 parallel bookings for the exact same slot
    const race = await Promise.all(
      users.map((u, idx) =>
        request(app)
          .post('/api/v1/appointments')
          .set('Authorization', `Bearer ${u.accessToken}`)
          .set('Idempotency-Key', `race-key-${idx}`)
          .send({ audiologistId: aud!.id, serviceId, startAt: slotA, bookedFor: { type: 'self' } }),
      ),
    );
    const created = race.filter((r) => r.status === 201);
    const conflicts = race.filter((r) => r.status === 409);
    expect(created.length).toBe(1);
    expect(conflicts.length).toBe(4);
    expect(conflicts[0].body.error.code).toBe('SLOT_TAKEN');
    expect(Array.isArray(conflicts[0].body.error.details.alternatives)).toBe(true);

    const winnerIdx = race.findIndex((r) => r.status === 201);
    const winnerToken = users[winnerIdx].accessToken;
    const loserToken = users[(winnerIdx + 1) % users.length].accessToken;
    const apptId = created[0].body.data.id;

    // Idempotency retry returns the same appointment
    const retry = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${winnerToken}`)
      .set('Idempotency-Key', `race-key-${winnerIdx}`)
      .send({ audiologistId: aud!.id, serviceId, startAt: slotA });
    expect(retry.status).toBe(201);
    expect(retry.body.data.id).toBe(apptId);

    // Another user cannot view or cancel it
    const otherGet = await request(app).get(`/api/v1/appointments/${apptId}`).set('Authorization', `Bearer ${loserToken}`);
    expect(otherGet.status).toBe(404);

    // Reschedule to slotB
    const resched = await request(app)
      .post(`/api/v1/appointments/${apptId}/reschedule`)
      .set('Authorization', `Bearer ${winnerToken}`)
      .send({ startAt: slotB });
    expect(resched.status).toBe(200);
    const newApptId = resched.body.data.id;
    expect(newApptId).not.toBe(apptId);

    // Cancel within 4h rule fails
    await Appointment.updateOne({ _id: newApptId }, { $set: { startAt: new Date(Date.now() + 2 * MS.HOUR) } });
    const tooLate = await request(app)
      .post(`/api/v1/appointments/${newApptId}/cancel`)
      .set('Authorization', `Bearer ${winnerToken}`)
      .send({ reason: 'Busy' });
    expect(tooLate.status).toBe(409);
    expect(tooLate.body.error.code).toBe('TOO_LATE_TO_CANCEL');

    // Cancel outside 4h succeeds
    await Appointment.updateOne({ _id: newApptId }, { $set: { startAt: new Date(Date.now() + 48 * MS.HOUR) } });
    const okCancel = await request(app)
      .post(`/api/v1/appointments/${newApptId}/cancel`)
      .set('Authorization', `Bearer ${winnerToken}`)
      .send({ reason: 'Travel' });
    expect(okCancel.status).toBe(200);
    expect(okCancel.body.data.status).toBe('cancelled');
  });

  it('runs reminder job idempotently for 24h and 2h windows', async () => {
    const user = await User.create({ phone: '+255719999001', name: 'Asha', language: 'en' });
    const aud = await Audiologist.findOne();
    const svc = await Service.findOne();

    const a24 = await Appointment.create({
      patient: user._id,
      audiologist: aud!._id,
      clinic: aud!.clinic,
      service: svc!._id,
      startAt: new Date(Date.now() + 23 * MS.HOUR),
      endAt: new Date(Date.now() + 24 * MS.HOUR),
      status: 'confirmed',
      remindersEnabled: true,
      snap: { audiologistName: aud!.name, clinicName: aud!.clinicName, serviceName: { en: 'Check', sw: 'Kipimo' } },
    });

    const sentFirst = await runRemindersOnce();
    expect(sentFirst).toBe(1);
    const sentSecond = await runRemindersOnce();
    expect(sentSecond).toBe(0);

    const updated = await Appointment.findById(a24._id);
    expect(updated?.reminders?.sent24h).toBe(true);
    const notifs = await Notification.countDocuments({ user: user._id, type: 'reminder' });
    expect(notifs).toBe(1);
  });

  it('serves bilingual education articles and lets patients save bookmarks', async () => {
    const auth = await loginPatient('0712999888');
    const listSw = await request(app).get('/api/v1/articles?lang=sw&featured=true');
    expect(listSw.status).toBe(200);
    expect(listSw.body.data.length).toBeGreaterThanOrEqual(1);
    const first = listSw.body.data[0];
    expect(first.language).toBe('sw');

    const detail = await request(app).get(`/api/v1/articles/${first.slug}?lang=sw`);
    expect(detail.status).toBe(200);
    expect(Array.isArray(detail.body.data.blocks)).toBe(true);

    const putSave = await request(app)
      .put(`/api/v1/me/saved-articles/${first.id}`)
      .set('Authorization', `Bearer ${auth.accessToken}`);
    expect(putSave.status).toBe(200);

    const saved = await request(app)
      .get('/api/v1/me/saved-articles')
      .set('Authorization', `Bearer ${auth.accessToken}`);
    expect(saved.body.data.some((a: any) => a.id === first.id)).toBe(true);
  });

  it('allows admin login, media upload, document import, and article publish', async () => {
    const login = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'admin@hearcare.local', password: 'ChangeMe123!' });
    expect(login.status).toBe(200);
    const token = login.body.token as string;

    const stats = await request(app).get('/api/v1/admin/stats').set('Authorization', `Bearer ${token}`);
    expect(stats.status).toBe(200);
    expect(stats.body.data.audiologists).toBeGreaterThanOrEqual(6);

    const up = await request(app)
      .post('/api/v1/admin/media')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', TINY_PNG, 'dot.png');
    expect(up.status).toBe(201);
    expect(up.body.id).toBeTruthy();

    const fetched = await request(app).get(`/media/${up.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.headers['content-type']).toBe('image/webp');

    const imp = await request(app)
      .post('/api/v1/admin/articles/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('# Ear Care Guide\n\nProtect your **hearing** every day.\n\n- Tip 1\n- Tip 2'), 'guide.md');
    expect(imp.status).toBe(200);
    expect(imp.body.title).toBe('Ear Care Guide');
    expect(imp.body.html).toContain('<strong>hearing</strong>');

    const topic = await Topic.findOne();
    const created = await request(app)
      .post('/api/v1/admin/articles')
      .set('Authorization', `Bearer ${token}`)
      .send({
        topicId: topic!.id,
        tag: 'care-guide',
        isFeatured: false,
        title: { en: imp.body.title, sw: '' },
        summary: { en: 'Protect your hearing every day.', sw: '' },
        bodyHtml: { en: imp.body.html, sw: '' },
      });
    expect(created.status).toBe(201);

    const pub = await request(app)
      .post(`/api/v1/admin/articles/${created.body.data.id}/publish`)
      .set('Authorization', `Bearer ${token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.status).toBe('published');
  });
});
