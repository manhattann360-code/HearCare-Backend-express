import { Article, Audiologist, Clinic, Region, Service, Topic } from '../models';
import { ensureAdmin } from '../services/auth';
import { htmlToBlocks, readMinutes, sanitizeArticleHtml } from '../services/content';

const REGIONS = [
  { name: 'Dar es Salaam', slug: 'dar-es-salaam', sortOrder: 1 },
  { name: 'Arusha', slug: 'arusha', sortOrder: 2 },
  { name: 'Dodoma', slug: 'dodoma', sortOrder: 3 },
  { name: 'Mwanza', slug: 'mwanza', sortOrder: 4 },
  { name: 'Kilimanjaro – Moshi', slug: 'kilimanjaro-moshi', sortOrder: 5 },
  { name: 'Mbeya', slug: 'mbeya', sortOrder: 6 },
  { name: 'Zanzibar', slug: 'zanzibar', sortOrder: 7 },
];

const SERVICES = [
  {
    slug: 'hearing-assessment',
    name: { en: 'Hearing assessment', sw: 'Upimaji wa kusikia' },
    description: { en: 'A full check of your hearing with an audiologist', sw: 'Uchunguzi kamili wa uwezo wako wa kusikia' },
    icon: 'hearing',
    forChildren: false,
    sortOrder: 1,
  },
  {
    slug: 'pediatric-audiology',
    name: { en: 'Pediatric audiology', sw: 'Huduma ya kusikia kwa watoto' },
    description: { en: 'Gentle hearing care tailored for children', sw: 'Huduma ya upole ya kusikia kwa watoto' },
    icon: 'child_care',
    forChildren: true,
    sortOrder: 2,
  },
  {
    slug: 'hearing-aid-fitting',
    name: { en: 'Hearing aid fitting', sw: 'Uwekaji wa kifaa cha kusaidia kusikia' },
    description: { en: 'Choose, fit and tune hearing aids', sw: 'Kuchagua, kupima na kurekebisha kifaa cha kusikia' },
    icon: 'hearing_aid',
    forChildren: false,
    sortOrder: 3,
  },
  {
    slug: 'tinnitus-consultation',
    name: { en: 'Tinnitus consultation', sw: 'Ushauri wa mlio masikioni' },
    description: { en: 'Support for ringing or buzzing in the ears', sw: 'Msaada kwa kelele au mlio usioisha masikioni' },
    icon: 'graphic_eq',
    forChildren: false,
    sortOrder: 4,
  },
  {
    slug: 'earwax-removal',
    name: { en: 'Earwax removal', sw: 'Usafishaji salama wa nta ya sikio' },
    description: { en: 'Safe, professional ear cleaning without swabs', sw: 'Usafishaji salama wa masikio unaofanywa na mtaalamu' },
    icon: 'clean_hands',
    forChildren: false,
    sortOrder: 5,
  },
  {
    slug: 'newborn-hearing-screening',
    name: { en: 'Newborn hearing screening', sw: 'Uchunguzi wa kusikia kwa watoto wachanga' },
    description: { en: 'Early hearing check for babies in their first weeks', sw: 'Uchunguzi wa mapema kwa watoto wachanga' },
    icon: 'crib',
    forChildren: true,
    sortOrder: 6,
  },
  {
    slug: 'vestibular-audiology',
    name: { en: 'Vestibular & Balance evaluation', sw: 'Uchunguzi wa kizunguzungu na usawa' },
    description: { en: 'Specialist care for dizziness, vertigo, and balance difficulties', sw: 'Huduma ya kitaalamu kwa kizunguzungu na changamoto za usawa' },
    icon: 'cyclone',
    forChildren: false,
    sortOrder: 7,
  },
  {
    slug: 'occupational-audiology',
    name: { en: 'Occupational hearing assessment', sw: 'Upimaji wa kusikia kazini' },
    description: { en: 'Workplace baseline and annual hearing tests for noisy industries', sw: 'Upimaji wa awali na wa mara kwa mara kwa wafanyakazi kwenye kelele' },
    icon: 'factory',
    forChildren: false,
    sortOrder: 8,
  },
];

const TOPICS = [
  { slug: 'hearing-loss', name: { en: 'Hearing loss', sw: 'Upotevu wa kusikia' }, icon: 'hearing_disabled', sortOrder: 1 },
  { slug: 'tinnitus', name: { en: 'Tinnitus', sw: 'Mlio masikioni (Tinnitus)' }, icon: 'graphic_eq', sortOrder: 2 },
  { slug: 'earwax', name: { en: 'Earwax', sw: 'Nta ya sikio' }, icon: 'clean_hands', sortOrder: 3 },
  { slug: 'noise-induced-hearing-loss', name: { en: 'Noise-induced hearing loss', sw: 'Athari za kelele kwa masikio' }, icon: 'volume_up', sortOrder: 4 },
  { slug: 'hearing-aids', name: { en: 'Hearing aids', sw: 'Vifaa vya kusaidia kusikia' }, icon: 'hearing_aid', sortOrder: 5 },
  { slug: 'children-and-hearing', name: { en: 'Children & hearing', sw: 'Watoto na uwezo wa kusikia' }, icon: 'child_care', sortOrder: 6 },
  { slug: 'newborn-hearing-screening', name: { en: 'Newborn hearing screening', sw: 'Uchunguzi wa watoto wachanga' }, icon: 'crib', sortOrder: 7 },
  { slug: 'speech-and-language-development', name: { en: 'Speech & language development', sw: 'Ukuaji wa usemi na lugha' }, icon: 'record_voice_over', sortOrder: 8 },
  { slug: 'dizziness-and-balance', name: { en: 'Dizziness & Balance', sw: 'Kizunguzungu na usawa' }, icon: 'cyclone', sortOrder: 9 },
];

export async function seedBase() {
  await ensureAdmin();

  for (const r of REGIONS) {
    await Region.updateOne({ slug: r.slug }, { $setOnInsert: r }, { upsert: true });
  }
  for (const s of SERVICES) {
    await Service.updateOne({ slug: s.slug }, { $setOnInsert: { ...s, isActive: true } }, { upsert: true });
  }
  for (const t of TOPICS) {
    await Topic.updateOne({ slug: t.slug }, { $setOnInsert: t }, { upsert: true });
  }
}

const WEEKDAY_HOURS = [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, start: '09:00', end: '16:00' }));
const MON_SAT_HOURS = [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, start: '09:00', end: dayOfWeek === 6 ? '13:00' : '17:00' }));

function buildArtContent(title: string, summary: string, rawHtml: string) {
  const html = sanitizeArticleHtml(rawHtml);
  return {
    title,
    summary,
    bodyHtml: html,
    blocks: htmlToBlocks(html),
    readMinutes: readMinutes(html),
  };
}

export async function seedDemo() {
  await seedBase();

  const regions = new Map((await Region.find().lean()).map((r) => [r.slug, r._id]));
  const services = new Map((await Service.find().lean()).map((s) => [s.slug, s._id]));
  const topics = new Map((await Topic.find().lean()).map((t) => [t.slug, t._id]));

  const clinicsData = [
    {
      name: 'CCBRT Hospital — Audiology Clinic',
      region: regions.get('dar-es-salaam'),
      district: 'Kinondoni',
      addressLine: 'Msasani Peninsula, Off Haile Selassie Rd, Dar es Salaam',
      lat: -6.7623,
      lng: 39.2665,
      phone: '+255222601543',
      whatsapp: '+255754000101',
      acceptsInsurance: ['NHIF', 'Cash'],
      paymentNote: 'NHIF and Cash accepted at clinic',
      openingHours: [
        { label: 'Mon – Fri', hours: '08:00 AM – 04:30 PM' },
        { label: 'Saturday', hours: '08:30 AM – 12:30 PM' },
      ],
    },
    {
      name: 'Muhimbili National Hospital — ENT & Audiology',
      region: regions.get('dar-es-salaam'),
      district: 'Ilala',
      addressLine: 'Kalenga Street, Upanga West, Dar es Salaam',
      lat: -6.8069,
      lng: 39.2747,
      phone: '+255222151367',
      whatsapp: '+255754000102',
      acceptsInsurance: ['NHIF', 'Cash'],
      paymentNote: 'NHIF and Cash accepted',
      openingHours: [{ label: 'Mon – Fri', hours: '08:00 AM – 04:00 PM' }],
    },
    {
      name: 'Aga Khan Hospital Dar es Salaam',
      region: regions.get('dar-es-salaam'),
      district: 'Ilala',
      addressLine: 'Barack Obama Drive, Dar es Salaam',
      lat: -6.8091,
      lng: 39.2889,
      phone: '+255222115151',
      whatsapp: '+255754000103',
      acceptsInsurance: ['NHIF', 'AAR', 'Jubilee', 'Cash'],
      paymentNote: 'Major insurance and Cash accepted',
      openingHours: [
        { label: 'Mon – Fri', hours: '08:00 AM – 05:00 PM' },
        { label: 'Saturday', hours: '09:00 AM – 01:00 PM' },
      ],
    },
    {
      name: 'KCMC Referral Hospital — Ear Clinic',
      region: regions.get('kilimanjaro-moshi'),
      district: 'Moshi Urban',
      addressLine: 'Sokoine Road, Moshi, Kilimanjaro',
      lat: -3.3204,
      lng: 37.3292,
      phone: '+255272754377',
      whatsapp: '+255754000104',
      acceptsInsurance: ['NHIF', 'Cash'],
      paymentNote: 'NHIF and Cash accepted',
      openingHours: [{ label: 'Mon – Fri', hours: '08:00 AM – 04:00 PM' }],
    },
    {
      name: 'Arusha Lutheran Medical Centre',
      region: regions.get('arusha'),
      district: 'Arusha City',
      addressLine: 'Makongoro Road, Arusha',
      lat: -3.3688,
      lng: 36.6879,
      phone: '+255272548035',
      whatsapp: '+255754000105',
      acceptsInsurance: ['NHIF', 'Strategis', 'Cash'],
      paymentNote: 'NHIF, Strategis and Cash accepted',
      openingHours: [
        { label: 'Mon – Fri', hours: '08:30 AM – 04:30 PM' },
        { label: 'Saturday', hours: '09:00 AM – 12:30 PM' },
      ],
    },
  ];

  const clinicDocs = new Map<string, any>();
  for (const c of clinicsData) {
    let doc = await Clinic.findOne({ name: c.name });
    if (!doc) doc = await Clinic.create(c);
    clinicDocs.set(c.name, doc);
  }

  const allServiceIds = [...services.values()];
  const childServices = [
    services.get('hearing-assessment')!,
    services.get('pediatric-audiology')!,
    services.get('newborn-hearing-screening')!,
  ];

  const audsData = [
    {
      name: 'Dr. Amani Lucas',
      title: 'Senior Clinical Audiologist',
      clinicName: 'CCBRT Hospital — Audiology Clinic',
      services: [services.get('hearing-assessment')!, services.get('hearing-aid-fitting')!, services.get('earwax-removal')!],
      languages: ['en', 'sw'],
      gender: 'male' as const,
      yearsExperience: 8,
      registrationNumber: 'TZ-AUD-0142',
      contactPhone: '+255754000101',
      weeklyHours: MON_SAT_HOURS,
      bio: {
        en: 'Experienced clinical audiologist specialising in adult diagnostic hearing assessments, safe earwax removal and modern hearing aid fittings.',
        sw: 'Mtaalamu mzoefu wa kusikia aliyebobea katika upimaji wa watu wazima, usafishaji salama wa masikio na vifaa vya kusaidia kusikia.',
      },
    },
    {
      name: 'Dr. Neema Mushi',
      title: 'Pediatric Audiologist',
      clinicName: 'Muhimbili National Hospital — ENT & Audiology',
      services: childServices,
      languages: ['en', 'sw'],
      gender: 'female' as const,
      yearsExperience: 11,
      registrationNumber: 'TZ-AUD-0098',
      contactPhone: '+255754000102',
      weeklyHours: WEEKDAY_HOURS,
      bio: {
        en: 'Dedicated to early childhood hearing health, newborn OAE screening and helping families support speech development.',
        sw: 'Mtaalamu wa afya ya kusikia kwa watoto na watoto wachanga, akisaidia familia kukuza uwezo wa lugha na usemi mapema.',
      },
    },
    {
      name: 'Dr. Sarah Kweka',
      title: 'Audiologist & Hearing Aid Specialist',
      clinicName: 'Aga Khan Hospital Dar es Salaam',
      services: [services.get('hearing-assessment')!, services.get('hearing-aid-fitting')!, services.get('tinnitus-consultation')!],
      languages: ['en', 'sw'],
      gender: 'female' as const,
      yearsExperience: 6,
      registrationNumber: 'TZ-AUD-0205',
      contactPhone: '+255754000103',
      weeklyHours: MON_SAT_HOURS,
      bio: {
        en: 'Focuses on personalised hearing aid selection, fine-tuning and practical listening strategies for busy workplaces and homes.',
        sw: 'Mtaalamu wa kuchagua na kurekebisha vifaa vya kusaidia kusikia pamoja na ushauri wa kutunza masikio.',
      },
    },
    {
      name: 'Dr. Juma Salum',
      title: 'Tinnitus & Hearing Specialist',
      clinicName: 'CCBRT Hospital — Audiology Clinic',
      services: [services.get('tinnitus-consultation')!, services.get('hearing-assessment')!, services.get('earwax-removal')!],
      languages: ['sw', 'en'],
      gender: 'male' as const,
      yearsExperience: 10,
      registrationNumber: 'TZ-AUD-0117',
      contactPhone: '+255754000101',
      weeklyHours: WEEKDAY_HOURS,
      bio: {
        en: 'Helps patients experiencing ringing or buzzing in the ears with evidence-based sound therapy and clear follow-up plans.',
        sw: 'Husaidia wagonjwa wenye kelele au mlio masikioni kwa kutumia ushauri wa kitaalamu na tiba ya sauti.',
      },
    },
    {
      name: 'Dr. Baraka Msuya',
      title: 'Clinical Audiologist',
      clinicName: 'KCMC Referral Hospital — Ear Clinic',
      services: allServiceIds,
      languages: ['en', 'sw'],
      gender: 'male' as const,
      yearsExperience: 9,
      registrationNumber: 'TZ-AUD-0164',
      contactPhone: '+255754000104',
      weeklyHours: WEEKDAY_HOURS,
      bio: {
        en: 'Provides comprehensive hearing evaluations and rehabilitation services for families across Northern Tanzania.',
        sw: 'Hutoa huduma kamili za upimaji na matibabu ya kusikia kwa familia katika kanda ya kaskazini.',
      },
    },
    {
      name: 'Dr. Grace Mollel',
      title: 'Audiologist',
      clinicName: 'Arusha Lutheran Medical Centre',
      services: [services.get('hearing-assessment')!, services.get('pediatric-audiology')!, services.get('earwax-removal')!],
      languages: ['en', 'sw'],
      gender: 'female' as const,
      yearsExperience: 5,
      registrationNumber: 'TZ-AUD-0231',
      contactPhone: '+255754000105',
      weeklyHours: MON_SAT_HOURS,
      bio: {
        en: 'Warm, patient-centred hearing care for adults and school-age children in Arusha.',
        sw: 'Huduma rafiki ya kusikia kwa watu wazima na watoto wa shule mkoani Arusha.',
      },
    },
  ];

  for (const a of audsData) {
    const clinic = clinicDocs.get(a.clinicName);
    if (!clinic) continue;
    const exists = await Audiologist.exists({ name: a.name, clinic: clinic._id });
    if (!exists) {
      await Audiologist.create({
        name: a.name,
        title: a.title,
        clinic: clinic._id,
        region: clinic.region,
        clinicName: clinic.name,
        insurance: clinic.acceptsInsurance,
        services: a.services,
        languages: a.languages,
        gender: a.gender,
        yearsExperience: a.yearsExperience,
        registrationNumber: a.registrationNumber,
        verifiedAt: new Date(),
        contactPhone: a.contactPhone,
        slotMinutes: 60,
        leadTimeHours: 2,
        maxDaysAhead: 30,
        weeklyHours: a.weeklyHours,
        isActive: true,
        bio: a.bio,
      });
    }
  }

  const articlesData = [
    {
      slug: 'safe-headphone-volume-guidelines',
      topic: topics.get('noise-induced-hearing-loss'),
      tag: 'prevention' as const,
      isFeatured: true,
      reviewedBy: { name: 'Dr. Amani Lucas', credential: 'Clinical Audiologist' },
      en: {
        title: 'Safe headphone volume guidelines',
        summary: 'Protect your ears with the simple 60/60 listening habit.',
        html: `<h2>Why loud headphones harm your ears</h2>
<p>Listening through earphones at high volume sends strong sound waves directly toward delicate hair cells inside your inner ear. Over time, these cells wear out and cannot grow back.</p>
<blockquote><p><strong>The 60/60 Rule</strong></p><p>Keep your device volume below 60% and take a 15-minute quiet break after every 60 minutes of listening.</p></blockquote>
<h2>Practical tips for noisy commutes</h2>
<ul><li>Use over-ear headphones in noisy buses (daladala) instead of turning volume all the way up.</li><li>If someone next to you can hear your music, it is too loud.</li><li>Give your ears quiet rest after concerts, church events or busy workshops.</li></ul>`,
      },
      sw: {
        title: 'Mwongozo salama wa sauti ya vipokea sauti',
        summary: 'Linda masikio yako kwa kanuni rahisi ya kusikiliza ya 60/60.',
        html: `<h2>Kwa nini sauti kubwa hudhuru masikio</h2>
<p>Kusikiliza kwa sauti ya juu kupitia vipokea sauti hupeleka mawimbi makali ya sauti kwenye seli nyeti za ndani ya sikio. Baada ya muda, seli hizi hudhoofika na haziwezi kurudi tena.</p>
<blockquote><p><strong>Kanuni ya 60/60</strong></p><p>Weka sauti ya simu chini ya asilimia 60 na pumzisha masikio kwa dakika 15 baada ya kila dakika 60 za kusikiliza.</p></blockquote>
<h2>Mambo ya kuzingatia kila siku</h2>
<ul><li>Epuka kuongeza sauti kupita kiasi unapokuwa kwenye daladala au mazingira yenye kelele.</li><li>Kama mtu aliye karibu nawe anasikia muziki wako, sauti iko juu sana.</li></ul>`,
      },
    },
    {
      slug: 'why-cotton-swabs-can-harm-your-ears',
      topic: topics.get('earwax'),
      tag: 'care-guide' as const,
      isFeatured: true,
      reviewedBy: { name: 'Dr. Juma Salum', credential: 'Audiologist' },
      en: {
        title: 'Why cotton swabs can harm your ears',
        summary: 'Safe ways to keep ears clean and when to visit a clinic.',
        html: `<h2>Earwax actually protects your ear</h2>
<p>Earwax traps dust and stops bacteria from reaching your eardrum. Most ears clean themselves naturally as old wax moves outward.</p>
<blockquote><p><strong>Never put objects in your ear canal</strong></p><p>Cotton swabs, hairpins and matchsticks push wax deeper and can scratch or tear the eardrum.</p></blockquote>
<h2>Safe cleaning steps</h2>
<ul><li>Clean only the outside of the ear gently with a warm, damp cloth.</li><li>If your ear feels blocked or sounds muffled, book a professional earwax removal visit.</li></ul>`,
      },
      sw: {
        title: 'Kwa nini vijiti vya pamba vinaweza kudhuru masikio',
        summary: 'Njia salama za kusafisha masikio na wakati wa kwenda kliniki.',
        html: `<h2>Nta ya sikio inalinda sikio lako</h2>
<p>Nta huzuia vumbi na vijidudu visifike kwenye kiwambo cha sikio. Masikio mengi hujisafisha yenyewe taratibu.</p>
<blockquote><p><strong>Usiingize kitu ndani ya tundu la sikio</strong></p><p>Vijiti vya pamba husukuma nta ndani zaidi na vinaweza kuchana au kutoboa kiwambo cha sikio.</p></blockquote>
<h2>Jinsi ya kusafisha kwa usalama</h2>
<ul><li>Safisha sehemu ya nje ya sikio pekee kwa kitambaa laini chenye unyevu.</li><li>Sikio likijisikia limeziba, muone mtaalamu wa kusikia kwa usafishaji salama.</li></ul>`,
      },
    },
    {
      slug: 'early-hearing-checks-for-school-age-children',
      topic: topics.get('children-and-hearing'),
      tag: 'children' as const,
      isFeatured: true,
      reviewedBy: { name: 'Dr. Neema Mushi', credential: 'Pediatric Audiologist' },
      en: {
        title: 'Early hearing checks for school-age children',
        summary: 'What parents can look out for at home and school.',
        html: `<h2>Why child hearing checks matter</h2>
<p>Even mild hearing difficulty can make it harder for a child to follow classroom lessons, learn to read and feel confident with friends.</p>
<h2>Signs to watch for</h2>
<ul><li>Often asking "what?" or turning one ear toward you when listening.</li><li>Sitting very close to the TV or turning the volume high.</li><li>Difficulty following instructions in noisy rooms or falling behind in class.</li></ul>
<blockquote><p><strong>Good news</strong></p><p>Many childhood hearing issues are temporary and treatable when checked early by an audiologist.</p></blockquote>`,
      },
      sw: {
        title: 'Uchunguzi wa mapema wa kusikia kwa watoto wa shule',
        summary: 'Dalili ambazo wazazi wanapaswa kuangalia nyumbani na shuleni.',
        html: `<h2>Kwa nini ni muhimu kupima mapema</h2>
<p>Hata tatizo dogo la kusikia linaweza kumfanya mtoto apate shida kufuatilia masomo darasani na kujifunza lugha.</p>
<h2>Dalili za kuzingatia</h2>
<ul><li>Kuuliza "unasemaje?" mara kwa mara au kugeuza sikio moja anaposikiliza.</li><li>Kuongeza sauti ya TV au redio kupita kiasi.</li><li>Kukosa umakini darasani au kuchelewa kuelewa maelekezo.</li></ul>`,
      },
    },
    {
      slug: 'understanding-tinnitus-ringing-in-the-ears',
      topic: topics.get('tinnitus'),
      tag: 'care-guide' as const,
      isFeatured: false,
      reviewedBy: { name: 'Dr. Juma Salum', credential: 'Tinnitus Specialist' },
      en: {
        title: 'Understanding tinnitus: ringing in the ears',
        summary: 'Common causes of ringing or buzzing and practical steps that help.',
        html: `<h2>What is tinnitus?</h2>
<p>Tinnitus is the sensation of ringing, buzzing, hissing or humming when no outside sound is present. It is a symptom, not a disease on its own.</p>
<h2>Common causes</h2>
<ul><li>Exposure to loud noise or music.</li><li>Earwax build-up blocking the ear canal.</li><li>Age-related changes in hearing or certain medicines.</li></ul>
<blockquote><p><strong>When to see an audiologist promptly</strong></p><p>Book an assessment if tinnitus is sudden, in one ear only, pulses with your heartbeat, or comes with dizziness.</p></blockquote>`,
      },
      sw: {
        title: 'Kuelewa tinnitus: mlio au kelele masikioni',
        summary: 'Sababu za kawaida za mlio masikioni na hatua zinazosaidia.',
        html: `<h2>Tinnitus ni nini?</h2>
<p>Tinnitus ni hali ya kusikia mlio au mvumo masikioni wakati hakuna sauti yoyote ya nje. Ni dalili inayoweza kuchunguzwa na mtaalamu.</p>
<h2>Hatua za kuchukua</h2>
<ul><li>Punguza mfiduo wa kelele kubwa.</li><li>Muone mtaalamu wa kusikia hasa kama mlio umeanza ghafla au uko kwenye sikio moja tu.</li></ul>`,
      },
    },
    {
      slug: 'signs-of-gradual-hearing-loss',
      topic: topics.get('hearing-loss'),
      tag: 'care-guide' as const,
      isFeatured: false,
      reviewedBy: { name: 'Dr. Amani Lucas', credential: 'Clinical Audiologist' },
      en: {
        title: 'Early signs of gradual hearing loss',
        summary: 'Recognising subtle changes before they affect daily conversations.',
        html: `<h2>Hearing often changes slowly</h2>
<p>Because gradual hearing loss develops over years, family members often notice it first. Getting a baseline hearing assessment makes it easy to act early.</p>
<ul><li>Voices sound mumbled, especially women's and children's voices.</li><li>Group conversations in busy restaurants feel tiring.</li><li>You feel people are speaking too softly.</li></ul>`,
      },
      sw: {
        title: 'Dalili za mapema za kupungua kwa uwezo wa kusikia',
        summary: 'Tambua mabadiliko madogo mapema kabla hayajaathiri mazungumzo.',
        html: `<h2>Mabadiliko hutokea polepole</h2>
<p>Mara nyingi familia huona dalili mapema. Kufanya kipimo cha kusikia kwa mtaalamu husaidia kupata suluhisho mapema.</p>
<ul><li>Maneno kusikika kama hayako wazi kwenye mikusanyiko yenye kelele.</li><li>Kuchoka haraka unaposikiliza mazungumzo marefu.</li></ul>`,
      },
    },
    {
      slug: 'caring-for-hearing-aids-in-humid-climates',
      topic: topics.get('hearing-aids'),
      tag: 'devices' as const,
      isFeatured: false,
      reviewedBy: { name: 'Dr. Sarah Kweka', credential: 'Hearing Aid Specialist' },
      en: {
        title: 'Caring for hearing aids in warm and humid weather',
        summary: 'Simple daily habits that keep your hearing aid clear and reliable.',
        html: `<h2>Moisture protection matters on the coast</h2>
<p>Humidity and sweat can build up inside microphones and battery doors. A quick evening routine extends the life of your device.</p>
<ul><li>Wipe the device gently with a dry, soft cloth every night.</li><li>Store it in a drying box or open battery compartment overnight.</li><li>Schedule a routine clinic check-up every 6 months.</li></ul>`,
      },
      sw: {
        title: 'Kutunza kifaa cha kusaidia kusikia kwenye hali ya hewa ya joto',
        summary: 'Tabia rahisi za kila siku za kulinda kifaa chako kisiharibiwe na unyevu.',
        html: `<h2>Linda kifaa chako dhidi ya unyevu</h2>
<p>Jasho na unyevu vinaweza kuathiri maikrofoni. Futa kifaa kwa kitambaa kikavu kila usiku na ukihifadhi mahali pakavu.</p>`,
      },
    },
    {
      slug: 'newborn-hearing-screening-explained',
      topic: topics.get('newborn-hearing-screening'),
      tag: 'children' as const,
      isFeatured: false,
      reviewedBy: { name: 'Dr. Neema Mushi', credential: 'Pediatric Audiologist' },
      en: {
        title: 'Newborn hearing screening: what parents should know',
        summary: 'A quick, painless check done in the first weeks of life.',
        html: `<h2>Quick, gentle and painless</h2>
<p>A newborn hearing screening takes only a few minutes while your baby sleeps. A soft earpiece measures how the inner ear responds to gentle sounds.</p>
<p>If your baby did not have a screening at birth, you can book one with a pediatric audiologist in your region.</p>`,
      },
      sw: {
        title: 'Uchunguzi wa kusikia kwa watoto wachanga',
        summary: 'Kipimo cha haraka na kisicho na maumivu katika wiki za mwanzo.',
        html: `<h2>Kipimo cha haraka na salama</h2>
<p>Kipimo hiki huchukua dakika chache tu mtoto akiwa amelala na hakina maumivu yoyote. Kama mtoto hakupimwa alipozaliwa, panga miadi na mtaalamu wa watoto.</p>`,
      },
    },
    {
      slug: 'how-hearing-supports-speech-and-language',
      topic: topics.get('speech-and-language-development'),
      tag: 'children' as const,
      isFeatured: false,
      reviewedBy: { name: 'Dr. Neema Mushi', credential: 'Pediatric Audiologist' },
      en: {
        title: 'How healthy hearing supports speech and language',
        summary: 'Milestones in the first three years and when to ask for a check.',
        html: `<h2>Listening comes before speaking</h2>
<p>Babies learn language by hearing clear speech sounds every day. Checking hearing early helps children reach communication milestones on time.</p>
<ul><li>By 6 months: turns head toward voices and laughs.</li><li>By 12 months: responds to their name and babbles.</li><li>By 2 years: uses two-word phrases and follows simple requests.</li></ul>`,
      },
      sw: {
        title: 'Jinsi kusikia kunavyosaidia ukuaji wa usemi na lugha',
        summary: 'Hatua muhimu katika miaka mitatu ya mwanzo ya mtoto.',
        html: `<h2>Kusikiliza huanza kabla ya kuongea</h2>
<p>Watoto hujifunza kuongea kwa kusikia sauti zilizo wazi kila siku. Kama mtoto hageuki anapoitwa au anachelewa kutoa maneno, muone mtaalamu wa kusikia.</p>`,
      },
    },
  ];

  const now = new Date();
  for (const a of articlesData) {
    if (!a.topic) continue;
    const exists = await Article.exists({ slug: a.slug });
    if (!exists) {
      await Article.create({
        slug: a.slug,
        topic: a.topic,
        tag: a.tag,
        status: 'published',
        isFeatured: a.isFeatured,
        reviewedBy: a.reviewedBy,
        publishedAt: now,
        content: {
          en: buildArtContent(a.en.title, a.en.summary, a.en.html),
          sw: buildArtContent(a.sw.title, a.sw.summary, a.sw.html),
        },
      });
    }
  }
}
