import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { OtpCode, RefreshToken, User, AdminUser } from '../models';
import { AppError } from '../utils/errors';
import { initials } from '../utils/text';
import { safeSms } from './sms';
import { signAccess } from '../middleware';

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const OTP_TTL_SEC = 5 * 60;

export async function requestOtp(phone: string) {
  const since = new Date(Date.now() - 10 * 60_000);
  const recent = await OtpCode.countDocuments({ phone, createdAt: { $gte: since } });
  if (recent >= 3) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many codes requested. Please wait a few minutes and try again.');
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await OtpCode.create({
    phone,
    codeHash: sha(`${phone}:${code}:${config.JWT_SECRET}`),
    expiresAt: new Date(Date.now() + OTP_TTL_SEC * 1000),
  });
  safeSms(phone, `Your HearCare code is ${code}. It expires in 5 minutes. Do not share it.`);
  const exposeDev = config.NODE_ENV !== 'production' && config.SMS_PROVIDER === 'console';
  return { ok: true, expiresInSec: OTP_TTL_SEC, ...(exposeDev ? { devCode: code } : {}) };
}

export async function verifyOtp(phone: string, code: string) {
  const isReview = !!config.REVIEW_PHONE && phone === config.REVIEW_PHONE && code === config.REVIEW_OTP;
  if (!isReview) {
    const otp = await OtpCode.findOne({ phone, consumedAt: null }).sort({ createdAt: -1 });
    if (!otp || otp.expiresAt.getTime() < Date.now()) {
      throw new AppError(400, 'OTP_EXPIRED', 'That code has expired. Please request a new one.');
    }
    if (otp.attempts >= 5) {
      throw new AppError(400, 'OTP_EXPIRED', 'Too many wrong attempts. Please request a new code.');
    }
    const expected = Buffer.from(sha(`${phone}:${code}:${config.JWT_SECRET}`));
    const actual = Buffer.from(otp.codeHash);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      otp.attempts += 1;
      await otp.save();
      throw new AppError(400, 'OTP_INVALID', "That code didn't work. Please try again.");
    }
    otp.consumedAt = new Date();
    await otp.save();
  }

  let user = await User.findOne({ phone });
  let isNewUser = false;
  if (!user) {
    user = await User.create({ phone, consentAcceptedAt: new Date() });
    isNewUser = true;
  } else if (user.deletedAt) {
    throw new AppError(403, 'FORBIDDEN', 'This account was deleted.');
  }
  const tokens = await issueTokens(user.id);
  return { ...tokens, user: await userDto(user.id), isNewUser };
}

export async function issueTokens(userId: string) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  await RefreshToken.create({
    user: userId,
    tokenHash: sha(refreshToken),
    expiresAt: new Date(Date.now() + 30 * 24 * 3600_000),
  });
  return { accessToken: signAccess(userId), refreshToken };
}

export async function rotateRefresh(token: string) {
  const doc = await RefreshToken.findOneAndDelete({ tokenHash: sha(token) });
  if (!doc || doc.expiresAt.getTime() < Date.now()) {
    throw new AppError(401, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.');
  }
  return issueTokens(String(doc.user));
}

export async function revokeRefresh(token: string) {
  await RefreshToken.deleteOne({ tokenHash: sha(token) });
}

export async function userDto(userId: string) {
  const u = await User.findById(userId).populate<{ region: { _id: any; name: string } | null }>('region', 'name');
  if (!u) throw new AppError(401, 'UNAUTHORIZED', 'Please sign in again.');
  return {
    id: u.id,
    phone: u.phone,
    name: u.name,
    initials: initials(u.name),
    regionId: u.region ? String(u.region._id) : null,
    regionName: u.region?.name ?? null,
    language: u.language,
    remindersEnabled: u.remindersEnabled,
    savedArticleIds: u.savedArticles.map(String),
  };
}

export async function loginAdmin(email: string, password: string) {
  const a = await AdminUser.findOne({ email: email.toLowerCase().trim() });
  if (!a || !(await bcrypt.compare(password, a.passwordHash))) {
    throw new AppError(401, 'UNAUTHORIZED', 'Wrong email or password.');
  }
  return a;
}

/** Create the first admin from env if none exist (works on first boot in production). */
export async function ensureAdmin() {
  if ((await AdminUser.estimatedDocumentCount()) > 0) return;
  await AdminUser.create({
    name: config.ADMIN_NAME,
    email: config.ADMIN_EMAIL.toLowerCase(),
    passwordHash: await bcrypt.hash(config.ADMIN_PASSWORD, 10),
  });
}
