import { Appointment, AudiologistDoc } from '../models';
import {
  MS, addDays, dayOfWeek, daysBetween, eatDateString, eatDayStartUtc, eatTime12, eatTime24,
  parseHHMM, slotLabel, Lang,
} from '../utils/time';

export interface Slot {
  startAt: Date;
}

type Rules = Pick<
  AudiologistDoc,
  'weeklyHours' | 'timeOff' | 'slotMinutes' | 'leadTimeHours' | 'maxDaysAhead'
>;

/**
 * Pure function: every bookable start time on `date` (YYYY-MM-DD, EAT),
 * ignoring existing bookings. Used for validation and for listing.
 */
export function generateDaySlots(rules: Rules, date: string, now: Date): Date[] {
  const today = eatDateString(now);
  const diff = daysBetween(today, date);
  if (diff < 0 || diff > rules.maxDaysAhead) return [];
  if (rules.timeOff?.some((t) => t.from && t.to && date >= t.from && date <= t.to)) return [];

  const dow = dayOfWeek(date);
  const dayStart = eatDayStartUtc(date).getTime();
  const earliest = now.getTime() + rules.leadTimeHours * MS.HOUR;
  const step = rules.slotMinutes;
  const out = new Map<number, Date>();

  for (const w of rules.weeklyHours ?? []) {
    if (w.dayOfWeek !== dow || !w.start || !w.end) continue;
    const s = parseHHMM(w.start);
    const e = parseHHMM(w.end);
    for (let t = s; t + step <= e; t += step) {
      const startMs = dayStart + t * MS.MIN;
      if (startMs >= earliest) out.set(startMs, new Date(startMs));
    }
  }
  return [...out.values()].sort((a, b) => a.getTime() - b.getTime());
}

/** Free slots (grid minus confirmed bookings) per date for a date range (inclusive). */
export async function freeSlotsByDate(
  aud: AudiologistDoc,
  from: string,
  to: string,
  now = new Date(),
): Promise<Record<string, Date[]>> {
  const rangeStart = eatDayStartUtc(from);
  const rangeEnd = eatDayStartUtc(addDays(to, 1));
  const taken = await Appointment.find(
    { audiologist: aud._id, status: 'confirmed', startAt: { $gte: rangeStart, $lt: rangeEnd } },
    { startAt: 1 },
  ).lean();
  const takenSet = new Set(taken.map((a) => a.startAt.getTime()));
  const result: Record<string, Date[]> = {};
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) {
    const date = addDays(from, i);
    result[date] = generateDaySlots(aud, date, now).filter((d) => !takenSet.has(d.getTime()));
  }
  return result;
}

export const slotDto = (d: Date) => ({
  startAt: d.toISOString(),
  time: eatTime24(d),
  label: eatTime12(d),
});

/** Next `count` free slots (scans up to maxDaysAhead, max 30 days). */
export async function nextSlots(
  aud: AudiologistDoc,
  count: number,
  lang: Lang,
  now = new Date(),
): Promise<{ startAt: string; label: string }[]> {
  const today = eatDateString(now);
  const horizon = Math.min(aud.maxDaysAhead, 30);
  const byDate = await freeSlotsByDate(aud, today, addDays(today, horizon), now);
  const out: { startAt: string; label: string }[] = [];
  for (const date of Object.keys(byDate).sort()) {
    for (const s of byDate[date]) {
      out.push({ startAt: s.toISOString(), label: slotLabel(s, now, lang) });
      if (out.length >= count) return out;
    }
  }
  return out;
}
