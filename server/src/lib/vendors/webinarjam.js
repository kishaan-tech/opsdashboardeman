// Normalize WebinarJam / EverWebinar custom webhook payloads → formSubmissionSchema.
// Point WJ "Custom Webhook" automation at:
//   POST /api/webhooks/<slug>/forms?source=webinarjam&secret=…

import {
  dig,
  findEmailDeep,
  findNameDeep,
  findPhoneDeep,
  fullName,
  hashSubmissionId,
} from './formUtils.js';

export function isWebinarjam(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.webinar_id != null || body.webinarId != null || body.webinar_hash) return true;
  if (body.event === 'registration' || body.event === 'attendance' || body.event === 'registrant') {
    return true;
  }
  if (body.user?.email && (body.user?.webinar_id != null || body.user?.live_room_url)) return true;
  if (typeof body.live_room_url === 'string' || typeof body.replay_room_url === 'string') return true;
  return false;
}

export function normalizeWebinarjam(body) {
  const root = body.data || body.user || body.registrant || body.attendee || body;
  const email = findEmailDeep(body) || findEmailDeep(root);
  if (!email) throw new Error('webinarjam payload missing email');

  const first = dig(root, 'first_name', 'firstName', 'firstname')
    || dig(body, 'first_name', 'firstName');
  const last = dig(root, 'last_name', 'lastName', 'lastname')
    || dig(body, 'last_name', 'lastName');
  const name = fullName(first, last, findNameDeep(body) || findNameDeep(root));
  const phone = findPhoneDeep(body) || findPhoneDeep(root);

  const webinarId = dig(body, 'webinar_id', 'webinarId', 'data.webinar_id', 'user.webinar_id')
    ?? dig(root, 'webinar_id', 'webinarId');
  const userId = dig(root, 'user_id', 'userId', 'id') || dig(body, 'user_id', 'registrant_id');
  const schedule = dig(root, 'schedule', 'schedule_id') || dig(body, 'schedule');

  const submissionId = String(
    userId
    || hashSubmissionId('wj', email, webinarId || '', schedule || '', dig(body, 'event') || 'reg'),
  );

  const webinarLabel = dig(body, 'webinar_name', 'webinarName', 'title', 'name')
    || (webinarId != null ? `webinar-${webinarId}` : 'webinarjam');

  const answers = {
    webinar_id: webinarId ?? null,
    schedule: schedule ?? null,
    event: dig(body, 'event') || null,
    date: dig(root, 'date') || dig(body, 'date') || null,
    timezone: dig(root, 'timezone') || null,
    live_room_url: dig(root, 'live_room_url') || dig(body, 'live_room_url') || null,
    replay_room_url: dig(root, 'replay_room_url') || dig(body, 'replay_room_url') || null,
  };

  return {
    form_name: String(webinarLabel),
    submission_id: submissionId,
    email,
    name: name || undefined,
    phone: phone || undefined,
    source: `webinarjam - ${webinarLabel}`,
    answers,
  };
}
