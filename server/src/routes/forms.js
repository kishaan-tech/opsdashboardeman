import { Router } from 'express';
import { ingest, upsertLead } from '../lib/ingest.js';
import { formSubmissionSchema } from '../schemas/index.js';
import { normalizeFormPayload } from '../lib/vendors/index.js';

// POST /webhooks/forms?source=typeform
// A form submission creates (or enriches) a lead. Full answers land on
// leads.form_answers so the admin UI can show Typeform details inline.
export const formsRouter = Router();

formsRouter.post('/', async (req, res) => {
  const source = String(req.query.source ?? 'form');
  const payload = normalizeFormPayload(req.body, source);
  const result = await ingest({
    source,
    eventType: 'form.submitted',
    externalId: payload?.submission_id,
    payload,
    schema: formSubmissionSchema,
    apply: async (data) => {
      const leadId = await upsertLead({
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
