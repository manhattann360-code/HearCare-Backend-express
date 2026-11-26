import type { Request } from 'express';
import type { Lang } from './time';

export type LText = { en?: string; sw?: string };

export function reqLang(req: Request): Lang {
  const q = String(req.query.lang ?? '').toLowerCase();
  if (q === 'sw' || q === 'en') return q;
  const h = String(req.headers['accept-language'] ?? '').toLowerCase();
  return h.startsWith('sw') ? 'sw' : 'en';
}

/** Pick the requested language, falling back to English then Swahili. */
export function loc(t: LText | undefined | null, lang: Lang): string {
  if (!t) return '';
  const primary = t[lang];
  if (primary && primary.trim()) return primary;
  return t.en?.trim() ? t.en : t.sw ?? '';
}

/** Normalise Tanzanian numbers to E.164 (+255XXXXXXXXX). Returns null if invalid. */
export function normalizePhone(input: string): string | null {
  let p = input.replace(/[\s\-()]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (/^0[67]\d{8}$/.test(p)) p = '+255' + p.slice(1);
  else if (/^255[67]\d{8}$/.test(p)) p = '+' + p;
  else if (/^[67]\d{8}$/.test(p)) p = '+255' + p;
  return /^\+255[67]\d{8}$/.test(p) ? p : null;
}

export function initials(name: string | undefined | null): string {
  if (!name) return '';
  const parts = name.replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i, '').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
