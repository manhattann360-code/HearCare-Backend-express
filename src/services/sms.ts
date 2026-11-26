import { config } from '../config';
import { logger } from '../utils/logger';

export interface SmsProvider {
  send(to: string, message: string): Promise<void>;
}

class ConsoleSms implements SmsProvider {
  async send(to: string, message: string) {
    logger.info({ to }, `[SMS:console] ${message}`);
    // eslint-disable-next-line no-console
    if (config.NODE_ENV !== 'test') console.log(`\n📱 SMS to ${to}: ${message}\n`);
  }
}

class AfricasTalkingSms implements SmsProvider {
  async send(to: string, message: string) {
    const sandbox = config.AT_USERNAME === 'sandbox';
    const url = sandbox
      ? 'https://api.sandbox.africastalking.com/version1/messaging'
      : 'https://api.africastalking.com/version1/messaging';
    const body = new URLSearchParams({ username: config.AT_USERNAME, to, message });
    if (config.SMS_SENDER_ID && !sandbox) body.set('from', config.SMS_SENDER_ID);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apiKey: config.AT_API_KEY,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) throw new Error(`Africa's Talking error ${res.status}: ${await res.text()}`);
  }
}

class BeemSms implements SmsProvider {
  async send(to: string, message: string) {
    const auth = Buffer.from(`${config.BEEM_API_KEY}:${config.BEEM_SECRET}`).toString('base64');
    const res = await fetch('https://apisms.beem.africa/v1/send', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_addr: config.SMS_SENDER_ID,
        schedule_time: '',
        encoding: 0,
        message,
        recipients: [{ recipient_id: 1, dest_addr: to.replace('+', '') }],
      }),
    });
    if (!res.ok) throw new Error(`Beem error ${res.status}: ${await res.text()}`);
  }
}

class TextifySms implements SmsProvider {
  async send(to: string, message: string) {
    if (!config.TEXTIFY_API_KEY) {
      logger.warn('Textify API key is not configured; skipping SMS delivery.');
      return;
    }
    const digits = to.replace(/\D/g, '');
    const receiver = digits.startsWith('0') ? `255${digits.slice(1)}` : digits;

    const payload: Record<string, unknown> = {
      is_scheduled: false,
      messages: [
        {
          receiver,
          content: message,
        },
      ],
    };

    const sender = config.TEXTIFY_SENDER_NAME || (config.SMS_SENDER_ID !== 'HearCare' ? config.SMS_SENDER_ID : '');
    if (sender) {
      payload.sender_name = sender;
    }

    const res = await fetch('https://portal.textify.africa/api/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.TEXTIFY_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.error({ status: res.status, errText, to: receiver }, 'Textify SMS delivery error');
      throw new Error(`Textify error ${res.status}: ${errText}`);
    }
  }
}

export const sms: SmsProvider =
  config.SMS_PROVIDER === 'textify'
    ? new TextifySms()
    : config.SMS_PROVIDER === 'africastalking'
      ? new AfricasTalkingSms()
      : config.SMS_PROVIDER === 'beem'
        ? new BeemSms()
        : new ConsoleSms();

/** Fire-and-forget SMS that never throws into request handlers. */
export function safeSms(to: string | undefined | null, message: string) {
  if (!to) return;
  sms.send(to, message).catch((err) => logger.error({ err, to }, 'SMS failed'));
}

/** Expo push (best effort). */
export async function sendPush(tokens: string[], title: string, body: string, data: object = {}) {
  const msgs = tokens
    .filter((t) => /^Expo(nent)?PushToken\[/.test(t))
    .map((to) => ({ to, title, body, data, sound: 'default' }));
  if (!msgs.length || config.NODE_ENV === 'test') return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(msgs),
    });
  } catch (err) {
    logger.error({ err }, 'Push failed');
  }
}
