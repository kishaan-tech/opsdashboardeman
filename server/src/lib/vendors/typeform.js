// Normalize Typeform webhook payloads → canonical formSubmissionSchema shape.
// Docs: https://developers.typeform.com/webhooks/example-payload/

function answerValue(answer) {
  if (!answer) return null;
  switch (answer.type) {
    case 'text':
    case 'email':
    case 'url':
    case 'date':
    case 'file_url':
    case 'phone_number':
      return answer[answer.type] ?? answer.text ?? null;
    case 'boolean':
      return answer.boolean;
    case 'number':
      return answer.number;
    case 'choice':
      return answer.choice?.label ?? answer.choice?.other ?? null;
    case 'choices':
      return answer.choices?.labels?.join(', ')
        ?? answer.choices?.other
        ?? null;
    case 'payment':
      return answer.payment
        ? `${answer.payment.amount} ${answer.payment.last4 ?? ''}`.trim()
        : null;
    default:
      return answer.text ?? answer.email ?? answer.number ?? null;
  }
}

function fieldTitle(definition, fieldId) {
  const field = definition?.fields?.find((f) => f.id === fieldId);
  return field?.title?.replace(/<[^>]+>/g, '').trim() || fieldId;
}

function pickContact(answers, definition) {
  let email;
  let name;
  let phone;

  for (const answer of answers ?? []) {
    const title = (fieldTitle(definition, answer.field?.id) || '').toLowerCase();
    const ref = (answer.field?.ref || '').toLowerCase();
    const value = answerValue(answer);

    if (answer.type === 'email' || title.includes('email') || ref.includes('email')) {
      if (typeof value === 'string' && value.includes('@')) email = value;
      continue;
    }
    if (answer.type === 'phone_number' || title.includes('phone') || ref.includes('phone')) {
      if (value != null) phone = String(value);
      continue;
    }
    if (
      !name
      && (title.includes('name') || ref.includes('name') || answer.type === 'text')
      && typeof value === 'string'
      && !value.includes('@')
    ) {
      // Prefer an explicit name field; otherwise first short text can be name.
      if (title.includes('name') || ref.includes('name')) name = value;
    }
  }

  // Second pass for name if still missing: first non-email text answer.
  if (!name) {
    for (const answer of answers ?? []) {
      if (answer.type === 'text' && answer.text) {
        name = answer.text;
        break;
      }
    }
  }

  return { email, name, phone };
}

export function isTypeform(body) {
  return Boolean(body?.form_response || body?.event_type === 'form_response');
}

export function normalizeTypeform(body) {
  const fr = body.form_response ?? body;
  const definition = fr.definition ?? {};
  const answersArr = fr.answers ?? [];
  const { email, name, phone } = pickContact(answersArr, definition);

  // Also accept hidden fields commonly used for contact info.
  const hidden = fr.hidden ?? {};
  const resolvedEmail = email
    ?? hidden.email
    ?? hidden.epost
    ?? Object.values(hidden).find((v) => typeof v === 'string' && v.includes('@'));

  const answers = {};
  for (const answer of answersArr) {
    const key = fieldTitle(definition, answer.field?.id);
    answers[key] = answerValue(answer);
  }
  if (Object.keys(hidden).length) answers._hidden = hidden;

  return {
    form_name: definition.title || fr.form_id || 'typeform',
    submission_id: fr.token || body.event_id || fr.form_id,
    email: resolvedEmail,
    name: name ?? hidden.name ?? hidden.navn ?? undefined,
    phone: phone ?? hidden.phone ?? hidden.telefon ?? undefined,
    source: `typeform - ${definition.title || fr.form_id || 'form'}`,
    answers,
    form_response_url: fr.response_url || undefined,
  };
}
