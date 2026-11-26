import { Types } from 'mongoose';
import { Appointment, Audiologist, Service, User } from '../models';
import { AppError, conflict, notFound } from '../utils/errors';
import { Lang, MS, eatDateString, longDateTime } from '../utils/time';
import { freeSlotsByDate, generateDaySlots, nextSlots } from './slots';
import { notifyUser } from './notify';
import { safeSms } from './sms';

export const CANCEL_WINDOW_HOURS = 4;
const MAX_UPCOMING = 3;

interface BookInput {
  audiologistId: string;
  serviceId: string;
  startAt: Date;
  bookedFor?: { type: 'self' | 'child' | 'other'; name?: string; ageYears?: number | null };
  note?: string;
  remindersEnabled?: boolean;
  idempotencyKey?: string;
}

async function alternativesFor(audId: Types.ObjectId, aud: any, lang: Lang, now: Date) {
  return nextSlots(aud, 3, lang, now);
}

async function assertSlotBookable(aud: any, startAt: Date, lang: Lang, now: Date) {
  const date = eatDateString(startAt);
  const grid = generateDaySlots(aud, date, now);
  if (!grid.some((d) => d.getTime() === startAt.getTime())) {
    throw new AppError(422, 'SLOT_INVALID', 'That time is not available for this audiologist. Please choose another time.');
  }
  const free = (await freeSlotsByDate(aud, date, date, now))[date] ?? [];
  if (!free.some((d) => d.getTime() === startAt.getTime())) {
    throw conflict('SLOT_TAKEN', 'That time was just booked. Please choose another time.', {
      alternatives: await alternativesFor(aud._id, aud, lang, now),
    });
  }
}

export async function createAppointment(
  userId: string,
  input: BookInput,
  lang: Lang = 'en',
  opts: { skipLimit?: boolean; now?: Date } = {},
) {
  const now = opts.now ?? new Date();

  if (input.idempotencyKey) {
    const existing = await Appointment.findOne({ patient: userId, idempotencyKey: input.idempotencyKey });
    if (existing) return existing;
  }

  const aud = await Audiologist.findById(input.audiologistId).populate<{ clinic: any }>({ path: 'clinic', populate: { path: 'region', select: 'name' } });
  if (!aud || !aud.isActive || !aud.verifiedAt) throw notFound('This audiologist is not available.');
  const service = await Service.findById(input.serviceId);
  if (!service || !aud.services.some((s) => String(s) === String(service._id))) {
    throw new AppError(422, 'SLOT_INVALID', 'This audiologist does not offer that service.');
  }

  if (!opts.skipLimit) {
    const upcoming = await Appointment.find({ patient: userId, status: 'confirmed', startAt: { $gte: now } }, { startAt: 1 }).lean();
    if (upcoming.length >= MAX_UPCOMING) {
      throw conflict('BOOKING_LIMIT', `You can have up to ${MAX_UPCOMING} upcoming appointments. Please cancel one first.`);
    }
    if (upcoming.some((a) => a.startAt.getTime() === input.startAt.getTime())) {
      throw conflict('BOOKING_LIMIT', 'You already have an appointment at this time.');
    }
  }

  await assertSlotBookable(aud, input.startAt, lang, now);

  const clinic = aud.clinic;
  const endAt = new Date(input.startAt.getTime() + aud.slotMinutes * MS.MIN);
  let appt;
  try {
    appt = await Appointment.create({
      patient: userId,
      audiologist: aud._id,
      clinic: clinic._id,
      service: service._id,
      startAt: input.startAt,
      endAt,
      bookedFor: {
        type: input.bookedFor?.type ?? 'self',
        name: input.bookedFor?.name ?? '',
        ageYears: input.bookedFor?.ageYears ?? null,
      },
      note: (input.note ?? '').slice(0, 300),
      remindersEnabled: input.remindersEnabled ?? true,
      idempotencyKey: input.idempotencyKey,
      snap: {
        audiologistName: aud.name,
        audiologistPhone: aud.contactPhone || clinic.phone,
        audiologistPhoto: aud.photoUrl ?? undefined,
        clinicName: clinic.name,
        clinicAddress: clinic.addressLine,
        clinicDistrict: clinic.district,
        clinicRegion: clinic.region?.name ?? '',
        clinicPhone: clinic.phone,
        clinicWhatsapp: clinic.whatsapp,
        clinicLat: clinic.lat ?? undefined,
        clinicLng: clinic.lng ?? undefined,
        serviceName: { en: service.name?.en ?? '', sw: service.name?.sw ?? '' },
      },
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      if (err.keyPattern?.idempotencyKey) {
        const again = await Appointment.findOne({ patient: userId, idempotencyKey: input.idempotencyKey });
        if (again) return again;
      }
      throw conflict('SLOT_TAKEN', 'That time was just booked. Please choose another time.', {
        alternatives: await alternativesFor(aud._id, aud, lang, now),
      });
    }
    throw err;
  }

  void afterBooked(appt, aud, lang);
  return appt;
}

async function afterBooked(appt: any, aud: any, lang: Lang) {
  try {
    const when = longDateTime(appt.startAt, lang);
    await notifyUser(String(appt.patient), {
      type: 'booking_confirmed',
      title: lang === 'sw' ? 'Miadi imethibitishwa' : 'Appointment confirmed',
      body: `${appt.snap.audiologistName} · ${when}`,
      data: { appointmentId: String(appt._id) },
      sms: `HearCare: Appointment confirmed with ${appt.snap.audiologistName} at ${appt.snap.clinicName}, ${when}. Please arrive 15 min early.`,
    });
    const user = await User.findById(appt.patient, { name: 1, phone: 1 }).lean();
    safeSms(
      aud.contactPhone,
      `HearCare: New booking - ${user?.name || user?.phone} on ${longDateTime(appt.startAt, 'en')} (${appt.snap.serviceName?.en}).`,
    );
  } catch {
    /* notifications are best-effort */
  }
}

export function canCancel(appt: { status: string; startAt: Date }, now = new Date()) {
  return appt.status === 'confirmed' && appt.startAt.getTime() - now.getTime() >= CANCEL_WINDOW_HOURS * MS.HOUR;
}

export async function cancelAppointment(
  appt: any,
  by: 'patient' | 'clinic' | 'admin',
  reason?: string,
  now = new Date(),
) {
  if (appt.status !== 'confirmed') throw conflict('VALIDATION_ERROR', 'This appointment is already closed.');
  if (by === 'patient' && !canCancel(appt, now)) {
    throw conflict(
      'TOO_LATE_TO_CANCEL',
      `Appointments can be cancelled up to ${CANCEL_WINDOW_HOURS} hours before the start time. Please call the clinic.`,
    );
  }
  appt.status = 'cancelled';
  appt.cancelledBy = by;
  appt.cancelReason = reason?.slice(0, 200) ?? null;
  await appt.save();
  if (by !== 'patient') {
    await notifyUser(String(appt.patient), {
      type: 'booking_cancelled',
      title: 'Appointment cancelled',
      body: `${appt.snap.audiologistName} · ${longDateTime(appt.startAt, 'en')}${reason ? ' — ' + reason : ''}`,
      data: { appointmentId: String(appt._id) },
      sms: `HearCare: Your appointment with ${appt.snap.audiologistName} on ${longDateTime(appt.startAt, 'en')} was cancelled${reason ? ' (' + reason + ')' : ''}. Please book another time in the app.`,
      push: true,
    });
  }
  return appt;
}

export async function rescheduleAppointment(old: any, newStart: Date, lang: Lang) {
  if (!canCancel(old)) {
    throw conflict('TOO_LATE_TO_CANCEL', `Appointments can be changed up to ${CANCEL_WINDOW_HOURS} hours before the start time.`);
  }
  // create first so the old booking survives if the new slot is unavailable
  const created = await createAppointment(
    String(old.patient?._id ?? old.patient),
    {
      audiologistId: String(old.audiologist?._id ?? old.audiologist),
      serviceId: String(old.service?._id ?? old.service),
      startAt: newStart,
      bookedFor: old.bookedFor,
      note: old.note,
      remindersEnabled: old.remindersEnabled,
    },
    lang,
    { skipLimit: true },
  );
  old.status = 'cancelled';
  old.cancelledBy = 'patient';
  old.cancelReason = 'Rescheduled';
  await old.save();
  return created;
}
