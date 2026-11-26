import cron from 'node-cron';
import { config, isTest } from '../config';
import { Appointment } from '../models';
import { notifyUser } from '../services/notify';
import { logger } from '../utils/logger';
import { longDateTime, MS } from '../utils/time';

export async function runRemindersOnce(now = new Date()) {
  const win24From = new Date(now.getTime() + 22 * MS.HOUR);
  const win24To = new Date(now.getTime() + 25 * MS.HOUR);
  const win2From = new Date(now.getTime() + 1 * MS.HOUR);
  const win2To = new Date(now.getTime() + 2.5 * MS.HOUR);

  let sentCount = 0;

  const due24 = await Appointment.find(
    {
      status: 'confirmed',
      remindersEnabled: true,
      'reminders.sent24h': false,
      startAt: { $gte: win24From, $lte: win24To },
    },
    { _id: 1 },
  ).lean();

  for (const item of due24) {
    const claimed = await Appointment.findOneAndUpdate(
      { _id: item._id, status: 'confirmed', 'reminders.sent24h': false },
      { $set: { 'reminders.sent24h': true } },
      { new: true },
    ).populate('patient', 'language');
    if (!claimed) continue;

    const lang = (claimed.patient as any)?.language === 'sw' ? 'sw' : 'en';
    const when = longDateTime(claimed.startAt, lang);
    await notifyUser(String(claimed.patient?._id ?? claimed.patient), {
      type: 'reminder',
      title: lang === 'sw' ? 'Kikumbusho: miadi kesho' : 'Reminder: appointment tomorrow',
      body: `${claimed.snap?.audiologistName ?? ''} · ${claimed.snap?.clinicName ?? ''} (${when})`,
      data: { appointmentId: String(claimed._id) },
      sms: config.SMS_REMINDERS
        ? `HearCare reminder: Your appointment with ${claimed.snap?.audiologistName} at ${claimed.snap?.clinicName} is tomorrow (${when}).`
        : undefined,
      push: true,
    });
    sentCount += 1;
  }

  const due2 = await Appointment.find(
    {
      status: 'confirmed',
      remindersEnabled: true,
      'reminders.sent2h': false,
      startAt: { $gte: win2From, $lte: win2To },
    },
    { _id: 1 },
  ).lean();

  for (const item of due2) {
    const claimed = await Appointment.findOneAndUpdate(
      { _id: item._id, status: 'confirmed', 'reminders.sent2h': false },
      { $set: { 'reminders.sent2h': true } },
      { new: true },
    ).populate('patient', 'language');
    if (!claimed) continue;

    const lang = (claimed.patient as any)?.language === 'sw' ? 'sw' : 'en';
    const when = longDateTime(claimed.startAt, lang);
    await notifyUser(String(claimed.patient?._id ?? claimed.patient), {
      type: 'reminder',
      title: lang === 'sw' ? 'Miadi yako iko karibu' : 'Your appointment is in 2 hours',
      body: `${claimed.snap?.audiologistName ?? ''} · ${claimed.snap?.clinicName ?? ''} (${when})`,
      data: { appointmentId: String(claimed._id) },
      sms: config.SMS_REMINDERS
        ? `HearCare reminder: Your appointment with ${claimed.snap?.audiologistName} at ${claimed.snap?.clinicName} is soon (${when}). Please arrive 15 min early.`
        : undefined,
      push: true,
    });
    sentCount += 1;
  }

  return sentCount;
}

let task: cron.ScheduledTask | null = null;

export function startReminderJob() {
  if (!config.RUN_JOBS || isTest) return;
  task = cron.schedule('*/5 * * * *', () => {
    runRemindersOnce().catch((err) => logger.error({ err }, 'Reminder job failed'));
  });
  logger.info('Appointment reminder job scheduled (every 5 min)');
}

export function stopReminderJob() {
  task?.stop();
  task = null;
}
