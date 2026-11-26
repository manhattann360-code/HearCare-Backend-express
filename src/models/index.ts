import { Schema, model, Types, InferSchemaType } from 'mongoose';

const L = { en: { type: String, default: '' }, sw: { type: String, default: '' } };
const opts = { timestamps: true } as const;

/* ---------------- Region ---------------- */
const regionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    sortOrder: { type: Number, default: 100 },
  },
  opts,
);
export const Region = model('Region', regionSchema);

/* ---------------- Service ---------------- */
const serviceSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: L,
    description: L,
    icon: { type: String, default: 'hearing' },
    forChildren: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 100 },
  },
  opts,
);
export const Service = model('Service', serviceSchema);

/* ---------------- Topic ---------------- */
const topicSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: L,
    icon: { type: String, default: 'menu_book' },
    sortOrder: { type: Number, default: 100 },
  },
  opts,
);
export const Topic = model('Topic', topicSchema);

/* ---------------- Clinic ---------------- */
const clinicSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    region: { type: Schema.Types.ObjectId, ref: 'Region', required: true },
    district: { type: String, default: '' },
    addressLine: { type: String, default: '' },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    phone: { type: String, default: '' },
    whatsapp: { type: String, default: '' },
    acceptsInsurance: { type: [String], default: [] },
    paymentNote: { type: String, default: '' },
    openingHours: {
      type: [{ _id: false, label: String, hours: String }],
      default: [],
    },
  },
  opts,
);
export const Clinic = model('Clinic', clinicSchema);

/* ---------------- Audiologist ---------------- */
const audiologistSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    title: { type: String, default: 'Audiologist' },
    photoUrl: { type: String, default: null },
    bio: L,
    clinic: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true },
    // denormalised from clinic for fast filtering / search
    region: { type: Schema.Types.ObjectId, ref: 'Region', required: true },
    clinicName: { type: String, default: '' },
    insurance: { type: [String], default: [] },
    services: [{ type: Schema.Types.ObjectId, ref: 'Service' }],
    languages: { type: [String], default: ['en', 'sw'] },
    gender: { type: String, enum: ['female', 'male', 'unspecified'], default: 'unspecified' },
    yearsExperience: { type: Number, default: 0 },
    registrationNumber: { type: String, default: '' },
    verifiedAt: { type: Date, default: null },
    contactPhone: { type: String, default: '' },
    slotMinutes: { type: Number, default: 60, min: 15, max: 120 },
    leadTimeHours: { type: Number, default: 2 },
    maxDaysAhead: { type: Number, default: 30 },
    weeklyHours: {
      type: [{ _id: false, dayOfWeek: Number, start: String, end: String }],
      default: [],
    },
    timeOff: {
      type: [{ _id: false, from: String, to: String, reason: { type: String, default: '' } }],
      default: [],
    },
    isActive: { type: Boolean, default: true },
  },
  opts,
);
audiologistSchema.index({ region: 1, services: 1, isActive: 1 });
audiologistSchema.index({ name: 'text', clinicName: 'text' });
export const Audiologist = model('Audiologist', audiologistSchema);
export type AudiologistDoc = InferSchemaType<typeof audiologistSchema> & { _id: Types.ObjectId };

/* ---------------- Appointment ---------------- */
const appointmentSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    audiologist: { type: Schema.Types.ObjectId, ref: 'Audiologist', required: true },
    clinic: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true },
    service: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['confirmed', 'cancelled', 'completed', 'no_show'],
      default: 'confirmed',
    },
    bookedFor: {
      type: new Schema(
        {
          type: { type: String, enum: ['self', 'child', 'other'], default: 'self' },
          name: { type: String, default: '' },
          ageYears: { type: Number, default: null },
        },
        { _id: false },
      ),
      default: () => ({ type: 'self', name: '', ageYears: null }),
    },
    note: { type: String, default: '', maxlength: 300 },
    remindersEnabled: { type: Boolean, default: true },
    cancelledBy: { type: String, enum: ['patient', 'clinic', 'admin', null], default: null },
    cancelReason: { type: String, default: null },
    reminders: {
      sent24h: { type: Boolean, default: false },
      sent2h: { type: Boolean, default: false },
    },
    idempotencyKey: { type: String },
    // snapshots so history survives later edits/deletions
    snap: {
      audiologistName: String,
      audiologistPhone: String,
      audiologistPhoto: String,
      clinicName: String,
      clinicAddress: String,
      clinicDistrict: String,
      clinicRegion: String,
      clinicPhone: String,
      clinicWhatsapp: String,
      clinicLat: Number,
      clinicLng: Number,
      serviceName: { en: String, sw: String },
    },
  },
  opts,
);
// THE anti-double-booking guarantee: one confirmed booking per audiologist per start time.
appointmentSchema.index(
  { audiologist: 1, startAt: 1 },
  { unique: true, partialFilterExpression: { status: 'confirmed' } },
);
appointmentSchema.index({ patient: 1, startAt: -1 });
appointmentSchema.index({ status: 1, startAt: 1 });
appointmentSchema.index(
  { patient: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
export const Appointment = model('Appointment', appointmentSchema);

/* ---------------- Article ---------------- */
const contentSchema = new Schema(
  {
    title: { type: String, default: '' },
    summary: { type: String, default: '' },
    bodyHtml: { type: String, default: '' },
    blocks: { type: Schema.Types.Mixed, default: [] },
    readMinutes: { type: Number, default: 1 },
  },
  { _id: false },
);
const articleSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    topic: { type: Schema.Types.ObjectId, ref: 'Topic', required: true },
    tag: {
      type: String,
      enum: ['care-guide', 'prevention', 'devices', 'children', 'general'],
      default: 'general',
    },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    isFeatured: { type: Boolean, default: false },
    heroImageUrl: { type: String, default: null },
    reviewedBy: {
      type: { _id: false, name: String, credential: String },
      default: null,
    },
    publishedAt: { type: Date, default: null },
    hasSwahili: { type: Boolean, default: false },
    content: { en: { type: contentSchema, default: () => ({}) }, sw: { type: contentSchema, default: () => ({}) } },
  },
  opts,
);
articleSchema.pre('save', function () {
  this.hasSwahili = !!(this.content?.sw?.title?.trim() && this.content?.sw?.bodyHtml?.trim());
});
articleSchema.index({ status: 1, topic: 1, publishedAt: -1 });
export const Article = model('Article', articleSchema);

/* ---------------- Users & auth ---------------- */
const userSchema = new Schema(
  {
    phone: { type: String, required: true, unique: true },
    name: { type: String, default: '' },
    region: { type: Schema.Types.ObjectId, ref: 'Region', default: null },
    language: { type: String, enum: ['en', 'sw'], default: 'en' },
    remindersEnabled: { type: Boolean, default: true },
    pushTokens: { type: [String], default: [] },
    savedArticles: [{ type: Schema.Types.ObjectId, ref: 'Article' }],
    consentAcceptedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  opts,
);
export const User = model('User', userSchema);

const adminSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  opts,
);
export const AdminUser = model('AdminUser', adminSchema);

const otpSchema = new Schema({
  phone: { type: String, required: true, index: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  attempts: { type: Number, default: 0 },
  consumedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});
export const OtpCode = model('OtpCode', otpSchema);

const refreshSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});
export const RefreshToken = model('RefreshToken', refreshSchema);

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['reminder', 'booking_confirmed', 'booking_cancelled', 'article'], required: true },
    title: String,
    body: String,
    data: { type: Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null },
  },
  opts,
);
export const Notification = model('Notification', notificationSchema);

export const allModels = [
  Region, Service, Topic, Clinic, Audiologist, Appointment, Article, User, AdminUser, OtpCode, RefreshToken, Notification,
];
