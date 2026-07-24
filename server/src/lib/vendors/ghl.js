// Normalize GoHighLevel (HighLevel) form / contact webhooks → formSubmissionSchema.
// Typical: workflow outbound webhook on Form Submitted, or contact create/update.

import {
  dig,
  findEmailDeep,
  findNameDeep,
  findPhoneDeep,
  hashSubmissionId,
} from './formUtils.js';

export function isGhl(body) {
  if (!body || typeof body !== 'object') return false;
  // Common GHL markers
  if (body.location && (body.location.id || body.locationId)) return true;
  if (typeof body.locationId === 'string' || typeof body.location_id === 'string') return true;
  if (body.contact && (body.contact.id || body.contact.email)) return true;
  if (body.customData || body.customField || body.customFields) return true;
  if (body.type === 'ContactCreate' || body.type === 'ContactUpdate' || body.type === 'FormSubmission') {
    return true;
  }
  if (body.webhookId || body.workflow?.id) return true;
  return false;
}

export function normalizeGhl(body) {
  const contact = body.contact || body.data?.contact || body;
  const email = findEmailDeep(body) || findEmailDeep(contact);
  if (!email) throw new Error('ghl payload missing email');

  const name = findNameDeep(body) || findNameDeep(contact);
  const phone = findPhoneDeep(body) || findPhoneDeep(contact);

  const submissionId = String(
    dig(body, 'submissionId', 'submission_id', 'id', 'contact.id', 'contactId', 'contact_id')
    || dig(contact, 'id')
    || hashSubmissionId('ghl', email, dig(body, 'timestamp', 'dateAdded', 'date_created') || ''),
  );

  const formName = String(
    dig(body, 'formName', 'form_name', 'form.name', 'workflow.name', 'name', 'surveyName')
    || 'ghl-form',
  );

  const answers = { ...(typeof contact === 'object' ? contact : {}), ...body };
  // Drop huge/noisy nests
  delete answers.contact;
  delete answers.workflow;
  delete answers.location;

  return {
    form_name: formName,
    submission_id: submissionId,
    email,
    name: name || undefined,
    phone: phone || undefined,
    source: `ghl - ${formName}`,
    answers,
  };
}
