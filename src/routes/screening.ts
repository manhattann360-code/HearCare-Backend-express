import { Router } from 'express';
import { z } from 'zod';
import { Appointment, ScreeningResult, User } from '../models';
import { optionalUser, requireUser, validate } from '../middleware';
import { reqLang } from '../utils/text';
import { appointmentDto } from '../services/dto';

export const screeningRouter = Router();

const SCREENING_QUESTIONS = [
  {
    id: 'phone',
    text: {
      en: 'Does a hearing problem cause you to use the phone less often than you would like?',
      sw: 'Je, tatizo la kusikia linakusababishia utumie simu mara chache kuliko unavyopenda?',
    },
    category: 'social',
  },
  {
    id: 'embarrass',
    text: {
      en: 'Does a hearing problem cause you to feel embarrassed when meeting new people?',
      sw: 'Je, tatizo la kusikia linakufanya ujisikie vibaya au kuona aibu unapokutana na watu wapya?',
    },
    category: 'emotional',
  },
  {
    id: 'frustrated',
    text: {
      en: 'Do you feel frustrated when talking to family members because you struggle to hear?',
      sw: 'Je, unajisikia kukata tamaa unapoongea na wanafamilia kwa sababu ya shida ya kusikia?',
    },
    category: 'emotional',
  },
  {
    id: 'whispers',
    text: {
      en: 'Do you have difficulty hearing whispers or soft sounds?',
      sw: 'Je, unapata shida kusikia sauti za kunong’ona au sauti za chini?',
    },
    category: 'functional',
  },
  {
    id: 'visits',
    text: {
      en: 'Does a hearing difficulty cause problems when visiting friends, relatives, or neighbors?',
      sw: 'Je, changamoto ya kusikia inakupa ugumu unapotembelea marafiki, ndugu au majirani?',
    },
    category: 'social',
  },
  {
    id: 'repeat',
    text: {
      en: 'Do you frequently find yourself asking people to repeat what they said?',
      sw: 'Je, unajikuta mara kwa mara ukiwaomba watu warudie kile walichosema?',
    },
    category: 'functional',
  },
  {
    id: 'tv_volume',
    text: {
      en: 'Do you need the TV or radio louder than others in the room find comfortable?',
      sw: 'Je, unahitaji kupandisha sauti ya runinga au redio zaidi ya wengine wanavyoona inatosha?',
    },
    category: 'functional',
  },
  {
    id: 'noisy_places',
    text: {
      en: 'Do you have difficulty following a conversation in noisy environments or restaurants?',
      sw: 'Je, unapata shida kuelewa mazungumzo kwenye maeneo yenye kelele au mkusanyiko?',
    },
    category: 'functional',
  },
  {
    id: 'tinnitus',
    text: {
      en: 'Do you experience ringing, buzzing, or hissing sounds in your ears (tinnitus)?',
      sw: 'Je, unahisi mlio, kelele au mluzi masikioni mwako (tinnitus)?',
    },
    category: 'symptom',
  },
  {
    id: 'noise_exposure',
    text: {
      en: 'Have you been exposed to loud noise regularly (e.g. factory, construction, loud music, traffic)?',
      sw: 'Je, umekuwa ukikabiliwa na kelele kubwa mara kwa mara (mfano viwandani, ujenzi, muziki mnene)?',
    },
    category: 'occupational',
  },
];

const RED_FLAGS = [
  {
    id: 'sudden_loss',
    text: {
      en: 'Have you experienced sudden loss of hearing in one or both ears in the last few days?',
      sw: 'Je, umepoteza uwezo wa kusikia ghafla katika sikio moja au yote mawili siku chache zilizopita?',
    },
  },
  {
    id: 'pain_discharge',
    text: {
      en: 'Are you currently experiencing severe ear pain, bleeding, or fluid drainage?',
      sw: 'Je, unahisi maumivu makali, damu au usaha/maji yakitoka masikioni hivi sasa?',
    },
  },
];

// GET /api/v1/screening/questions
screeningRouter.get('/screening/questions', (req, res) => {
  const lang = reqLang(req);
  res.json({
    data: {
      disclaimer: {
        en: 'Screening is not the same as a diagnostic hearing assessment. It identifies potential hearing risk and helps you take the right next steps.',
        sw: 'Uchunguzi huu wa awali (screening) si sawa na kipimo rasmi cha uchunguzi wa kimatibabu. Unakusaidia kutambua viashiria vya changamoto ya kusikia na hatua stahiki za kuchukua.',
      }[lang],
      questions: SCREENING_QUESTIONS.map((q) => ({
        id: q.id,
        text: q.text[lang],
        category: q.category,
      })),
      redFlags: RED_FLAGS.map((rf) => ({
        id: rf.id,
        text: rf.text[lang],
      })),
      options: [
        { label: { en: 'No', sw: 'Hapana' }[lang], value: 'no', score: 0 },
        { label: { en: 'Sometimes', sw: 'Wakati mwingine' }[lang], value: 'sometimes', score: 2 },
        { label: { en: 'Yes', sw: 'Ndiyo' }[lang], value: 'yes', score: 4 },
      ],
    },
  });
});

const evaluateSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string(),
      answer: z.enum(['no', 'sometimes', 'yes']),
    }),
  ),
  redFlags: z.array(z.string()).optional(),
  guestId: z.string().optional(),
});

type EvaluateBody = z.infer<typeof evaluateSchema>;

// POST /api/v1/screening/evaluate
screeningRouter.post('/screening/evaluate', optionalUser, validate(evaluateSchema), async (req, res) => {
  const lang = reqLang(req);
  const { answers, redFlags = [], guestId } = req.body as EvaluateBody;

  let totalScore = 0;
  const scoredAnswers = answers.map((a) => {
    let score = 0;
    if (a.answer === 'yes') score = 4;
    else if (a.answer === 'sometimes') score = 2;
    totalScore += score;
    return { questionId: a.questionId, answer: a.answer, score };
  });

  const hasRedFlags = redFlags.length > 0;
  const isRefer = totalScore >= 10 || hasRedFlags;
  const result: 'pass' | 'refer' = isRefer ? 'refer' : 'pass';

  let severity: 'low_risk' | 'mild_moderate' | 'significant' = 'low_risk';
  if (totalScore >= 26 || hasRedFlags) {
    severity = 'significant';
  } else if (totalScore >= 10) {
    severity = 'mild_moderate';
  }

  const recommendations: string[] = [];
  if (lang === 'sw') {
    if (hasRedFlags) {
      recommendations.push('Una dalili za dharura (kupoteza kusikia ghafla au maumivu). Tafadhali muone daktari wa masikio/audiologist haraka iwezekanavyo leo.');
    } else if (severity === 'significant') {
      recommendations.push('Matokeo yanaonyesha dalili za changamoto kubwa ya kusikia. Tunapendekeza upime vipimo rasmi vya kitaalamu (PTA) kwa mtaalamu wa kusikia.');
    } else if (severity === 'mild_moderate') {
      recommendations.push('Kuna viashiria vya ugumu wa kusikia katika mazingira ya kawaida au mikusanyiko. Ni vyema kuonana na mtaalamu kwa tathmini zaidi.');
    } else {
      recommendations.push('Uwezo wako wa kusikia uko vizuri kulingana na majibu yako. Dumisha usafi salama wa masikio na epuka sauti kubwa sana.');
      recommendations.push('Fanya uchunguzi wa kawaida mara moja kila mwaka.');
    }
  } else {
    if (hasRedFlags) {
      recommendations.push('You indicated urgent symptoms (sudden hearing loss or pain). Please visit an audiologist or ENT specialist immediately today.');
    } else if (severity === 'significant') {
      recommendations.push('Your responses indicate noticeable hearing difficulty. We strongly recommend booking a comprehensive diagnostic assessment (PTA) with an audiologist.');
    } else if (severity === 'mild_moderate') {
      recommendations.push('You show mild-to-moderate indicators of hearing strain in conversations or noise. An assessment by an audiologist is recommended.');
    } else {
      recommendations.push('Your hearing risk score is within healthy limits. Keep protecting your ears from loud noise and avoid cotton swabs.');
      recommendations.push('Consider periodic routine checks once a year.');
    }
  }

  const doc = await ScreeningResult.create({
    user: req.userId || null,
    guestId: guestId || null,
    answers: scoredAnswers,
    totalScore,
    result,
    severity,
    recommendations,
    hasRedFlags,
    completedAt: new Date(),
  });

  res.json({
    data: {
      id: doc._id.toString(),
      totalScore,
      maxScore: 40,
      result,
      severity,
      hasRedFlags,
      disclaimer: {
        en: 'Screening is not the same as a diagnostic hearing assessment. Please consult an audiologist for full medical evaluation.',
        sw: 'Uchunguzi huu wa awali (screening) si sawa na kipimo rasmi cha uchunguzi wa kimatibabu. Wasiliana na mtaalamu wa afya ya masikio kwa uchunguzi kamili.',
      }[lang],
      recommendations,
      completedAt: doc.completedAt.toISOString(),
      canBookDirectly: result === 'refer',
    },
  });
});

// GET /api/v1/me/passport - The Patient's Hearing Passport
screeningRouter.get('/me/passport', requireUser, async (req, res) => {
  const lang = reqLang(req);
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const [screenings, appointments] = await Promise.all([
    ScreeningResult.find({ user: user._id }).sort({ completedAt: -1 }).limit(10),
    Appointment.find({ patient: user._id })
      .populate('clinic')
      .populate('audiologist')
      .populate('service')
      .sort({ startAt: -1 }),
  ]);

  const passportNumber = `TZ-HC-${user._id.toString().slice(-6).toUpperCase()}`;

  res.json({
    data: {
      passportNumber,
      holderName: user.name || 'HearCare Patient',
      phone: user.phone,
      totalScreenings: screenings.length,
      latestScreening: screenings[0]
        ? {
            id: screenings[0]._id.toString(),
            result: screenings[0].result,
            totalScore: screenings[0].totalScore,
            completedAt: screenings[0].completedAt.toISOString(),
            recommendations: screenings[0].recommendations,
          }
        : null,
      screeningHistory: screenings.map((s) => ({
        id: s._id.toString(),
        result: s.result,
        totalScore: s.totalScore,
        severity: s.severity,
        completedAt: s.completedAt.toISOString(),
      })),
      appointments: appointments.map((a) => appointmentDto(a, lang)),
      medicalNotice: {
        en: 'Your hearing history travels with you. Show this digital passport to your audiologist or ENT specialist during appointments.',
        sw: 'Historia yako ya kusikia inasafiri nawe. Onyesha kitambulisho hiki cha kidijitali kwa mtaalamu wako wa afya ya masikio unapotembelea kliniki.',
      }[lang],
    },
  });
});
