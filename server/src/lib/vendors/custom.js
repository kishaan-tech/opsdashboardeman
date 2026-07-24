// Normalize generic / custom form POSTs → formSubmissionSchema.
// Accepts already-canonical bodies or flat { email, name, phone, form_name, … }.

import {
  dig,
  findEmailDeep,
  findNameDeep,
  findPhoneDeep,
  hashSubmissionId,
} from './formUtils.js';

export function isCustomForm(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.submission_id && body.email && body.form_name) return true;
  if (findEmailDeep(body)) return true;
  return false;
}

export function normalizeCustomForm(body) {
  // Already canonical
  if (body.submission_id && body.email && body.form_name) {
    return {
      form_name: String(body.form_name),
      submission_id: String(body.submission_id),
      email: String(body.email).trim().toLowerCase(),
      name: body.name ? String(body.name) : undefined,
      phone: body.phone ? String(body.phone) : undefined,
      source: body.source || `custom - ${body.form_name}`,
      answers: body.answers && typeof body.answers === 'object' ? body.answers : undefined,
      form_response_url: body.form_response_url || undefined,
    };
  }

  const email = findEmailDeep(body);
  if (!email) throw new Error('custom form missing email');

  const formName = String(dig(body, 'form_name', 'formName', 'form', 'source', 'name') || 'custom-form');
  const submissionId = String(
    dig(body, 'submission_id', 'submissionId', 'id', 'response_id', 'responseId')
    || hashSubmissionId('custom', email, dig(body, 'submitted_at', 'created_at', 'timestamp') || Date.now()),
  );

  const answers = { ...body };
  delete answers.email;
  delete answers.name;
  delete answers.phone;
  delete answers.form_name;
  delete answers.submission_id;

  return {
    form_name: formName,
    submission_id: submissionId,
    email,
    name: findNameDeep(body) || undefined,
    phone: findPhoneDeep(body) || undefined,
    source: `custom - ${formName}`,
    answers,
  };
}
