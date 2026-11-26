import { Notification, User } from '../models';
import { safeSms, sendPush } from './sms';

export async function notifyUser(
  userId: string,
  n: {
    type: 'reminder' | 'booking_confirmed' | 'booking_cancelled' | 'article';
    title: string;
    body: string;
    data?: object;
    sms?: string;
    push?: boolean;
  },
) {
  await Notification.create({ user: userId, type: n.type, title: n.title, body: n.body, data: n.data ?? {} });
  const user = await User.findById(userId, { phone: 1, pushTokens: 1 }).lean();
  if (!user) return;
  if (n.sms) safeSms(user.phone, n.sms);
  if (n.push) void sendPush(user.pushTokens ?? [], n.title, n.body, n.data ?? {});
}
