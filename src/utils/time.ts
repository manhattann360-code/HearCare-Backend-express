/**
 * Tanzania uses East Africa Time (UTC+3) all year, no daylight saving.
 * That makes date maths simple and dependency-free.
 */
export const EAT_OFFSET_MIN = 180;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD for an instant, in EAT */
export function eatDateString(d: Date): string {
  const t = new Date(d.getTime() + EAT_OFFSET_MIN * MIN);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function isDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

/** UTC instant of 00:00 EAT on the given date */
export function eatDayStartUtc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - EAT_OFFSET_MIN * MIN);
}

/** 0 = Sunday … 6 = Saturday for a YYYY-MM-DD date */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((eatDayStartUtc(to).getTime() - eatDayStartUtc(from).getTime()) / DAY);
}

export function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

/** "HH:mm" (24h) in EAT */
export function eatTime24(d: Date): string {
  const t = new Date(d.getTime() + EAT_OFFSET_MIN * MIN);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** "10:00 AM" in EAT */
export function eatTime12(d: Date): string {
  const t = new Date(d.getTime() + EAT_OFFSET_MIN * MIN);
  const h = t.getUTCHours();
  const m = pad(t.getUTCMinutes());
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_SW = ['Jpl', 'Jtt', 'Jnn', 'Jtn', 'Alh', 'Ijm', 'Jms'];
const WD_EN_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WD_SW_LONG = ['Jumapili', 'Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi'];
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_SW = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'];

export type Lang = 'en' | 'sw';

/** "Today, 2:00 PM" / "Tomorrow, 10:00 AM" / "Thu 26, 11:30 AM" */
export function slotLabel(startAt: Date, now: Date, lang: Lang = 'en'): string {
  const today = eatDateString(now);
  const date = eatDateString(startAt);
  const diff = daysBetween(today, date);
  const time = eatTime12(startAt);
  if (diff === 0) return `${lang === 'sw' ? 'Leo' : 'Today'}, ${time}`;
  if (diff === 1) return `${lang === 'sw' ? 'Kesho' : 'Tomorrow'}, ${time}`;
  const wd = (lang === 'sw' ? WD_SW : WD_EN)[dayOfWeek(date)];
  return `${wd} ${Number(date.slice(8))}, ${time}`;
}

/** "Monday, 23 Nov 2026 · 10:00 AM" */
export function longDateTime(startAt: Date, lang: Lang = 'en'): string {
  const date = eatDateString(startAt);
  const wd = (lang === 'sw' ? WD_SW_LONG : WD_EN_LONG)[dayOfWeek(date)];
  const mon = (lang === 'sw' ? MON_SW : MON_EN)[Number(date.slice(5, 7)) - 1];
  return `${wd}, ${Number(date.slice(8))} ${mon} ${date.slice(0, 4)} · ${eatTime12(startAt)}`;
}

export const MS = { MIN, DAY, HOUR: 60 * MIN };
