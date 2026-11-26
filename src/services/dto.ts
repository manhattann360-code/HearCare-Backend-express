import { Lang, slotLabel } from '../utils/time';
import { initials, loc } from '../utils/text';
import { absUrl, absBlocks } from './content';
import { canCancel, CANCEL_WINDOW_HOURS } from './booking';
import { MS } from '../utils/time';
import { nextSlots } from './slots';

const idOf = (v: any) => String(v?._id ?? v);

export async function audiologistSummary(a: any, lang: Lang, withNext = true) {
  const clinic = a.clinic && a.clinic.name ? a.clinic : null;
  const services = (a.services ?? []).filter((s: any) => s?.name);
  let next: { startAt: string; label: string } | null = null;
  if (withNext) next = (await nextSlots(a, 1, lang))[0] ?? null;
  return {
    id: idOf(a),
    name: a.name,
    title: a.title,
    initials: initials(a.name),
    photoUrl: absUrl(a.photoUrl),
    yearsExperience: a.yearsExperience,
    verified: true as const,
    languages: a.languages,
    gender: a.gender,
    acceptsInsurance: a.insurance ?? [],
    paymentNote: clinic?.paymentNote ?? '',
    services: services.map((s: any) => ({ id: idOf(s), name: loc(s.name, lang) })),
    clinic: {
      id: idOf(a.clinic),
      name: clinic?.name ?? a.clinicName,
      region: clinic?.region?.name ?? '',
      district: clinic?.district ?? '',
    },
    nextSlot: next,
  };
}

export async function audiologistDetail(a: any, lang: Lang) {
  const base = await audiologistSummary(a, lang, false);
  const c = a.clinic;
  return {
    ...base,
    bio: loc(a.bio, lang),
    contactPhone: a.contactPhone || c?.phone || '',
    slotMinutes: a.slotMinutes,
    clinic: {
      ...base.clinic,
      addressLine: c?.addressLine ?? '',
      lat: c?.lat ?? null,
      lng: c?.lng ?? null,
      phone: c?.phone ?? '',
      whatsapp: c?.whatsapp ?? '',
      openingHours: (c?.openingHours ?? []).map((h: any) => ({ label: h.label, hours: h.hours })),
    },
    nextSlot: undefined,
    nextSlots: await nextSlots(a, 3, lang),
  };
}

export function appointmentDto(a: any, lang: Lang = 'en') {
  const s = a.snap ?? {};
  const aud = a.audiologist && a.audiologist.name ? a.audiologist : null;
  return {
    id: idOf(a),
    status: a.status,
    startAt: a.startAt.toISOString(),
    endAt: a.endAt.toISOString(),
    audiologist: {
      id: idOf(a.audiologist),
      name: aud?.name ?? s.audiologistName,
      initials: initials(aud?.name ?? s.audiologistName),
      photoUrl: absUrl(aud?.photoUrl ?? s.audiologistPhoto),
      phone: s.audiologistPhone ?? '',
    },
    clinic: {
      id: idOf(a.clinic),
      name: s.clinicName,
      addressLine: s.clinicAddress ?? '',
      district: s.clinicDistrict ?? '',
      region: s.clinicRegion ?? '',
      lat: s.clinicLat ?? null,
      lng: s.clinicLng ?? null,
      phone: s.clinicPhone ?? '',
      whatsapp: s.clinicWhatsapp ?? '',
    },
    service: { id: idOf(a.service), name: loc(s.serviceName, lang) },
    bookedFor: { type: a.bookedFor?.type ?? 'self', name: a.bookedFor?.name ?? '', ageYears: a.bookedFor?.ageYears ?? null },
    note: a.note,
    remindersEnabled: a.remindersEnabled,
    canCancel: canCancel(a),
    cancelDeadline: new Date(a.startAt.getTime() - CANCEL_WINDOW_HOURS * MS.HOUR).toISOString(),
    cancelledBy: a.cancelledBy ?? null,
    cancelReason: a.cancelReason ?? null,
    createdAt: a.createdAt?.toISOString?.() ?? null,
  };
}

export function articleSummary(a: any, lang: Lang) {
  const swReady =
    a.content?.sw?.bodyHtml !== undefined
      ? !!(a.content?.sw?.title?.trim() && a.content?.sw?.bodyHtml?.trim())
      : !!(a.hasSwahili && a.content?.sw?.title?.trim());
  const useLang: Lang = lang === 'sw' && swReady ? 'sw' : 'en';
  const c = a.content?.[useLang] ?? {};
  return {
    id: idOf(a),
    slug: a.slug,
    title: c.title ?? '',
    summary: c.summary ?? '',
    heroImageUrl: absUrl(a.heroImageUrl),
    readMinutes: c.readMinutes ?? 1,
    tag: a.tag,
    topic: a.topic?.name
      ? { id: idOf(a.topic), slug: a.topic.slug, name: loc(a.topic.name, lang) }
      : { id: idOf(a.topic), slug: '', name: '' },
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    isFeatured: a.isFeatured,
    language: useLang,
  };
}

export function articleDetail(a: any, lang: Lang) {
  const base = articleSummary(a, lang);
  const c = a.content?.[base.language] ?? {};
  return {
    ...base,
    blocks: absBlocks(c.blocks ?? []),
    reviewedBy: a.reviewedBy?.name ? { name: a.reviewedBy.name, credential: a.reviewedBy.credential ?? '' } : null,
    updatedAt: a.updatedAt?.toISOString?.() ?? null,
  };
}

export { slotLabel };
