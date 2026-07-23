import { Router } from 'express';
import { ingest, upsertLead } from '../lib/ingest.js';
import { formSubmissionSchema } from '../schemas/index.js';
import { normalizeFormPayload } from '../lib/vendors/index.js';

// POST /webhooks/:orgSlug/forms?source=typeform
export const formsRouter = Router({ mergeParams: true });

formsRouter.post('/', async (req, res) => {
  const orgId = req.org?.id;
  if (!orgId) return res.status(400).json({ ok: false, error: 'org required' });

  const source = String(req.query.source ?? 'form');
  const payload = normalizeFormPayload(req.body, source);
  const result = await ingest({
    orgId,
    source,
    eventType: 'form.submitted',
    externalId: payload?.submission_id,
    payload,
    schema: formSubmissionSchema,
    apply: async (data) => {
      const leadId = await upsertLead({
        orgId,
        email: data.email,
        name: data.name,
        phone: data.phone,
        sourceLabel: data.source ?? data.form_name,
        formAnswers: data.answers,
        formResponseUrl: data.form_response_url,
      });
      return { table: 'leads', id: leadId };
    },
  });
  res.status(result.status).json(result.body);
});
