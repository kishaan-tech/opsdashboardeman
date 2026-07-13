import { Router } from 'express';
import { ingest, upsertLead } from '../lib/ingest.js';
import { formSubmissionSchema } from '../schemas/index.js';

// POST /webhooks/forms
// A form submission creates (or enriches) a lead. The full answers payload is
// preserved on the ingestion_events row.
export const formsRouter = Router();

formsRouter.post('/', async (req, res) => {
  const payload = normalize(req.body);
  const result = await ingest({
    source: req.query.source ?? 'form',
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
      });
      return { table: 'leads', id: leadId };
    },
  });
  res.status(result.status).json(result.body);
});

// Adapt vendor payloads to the canonical shape here if a tool can't be
// field-mapped in Zapier.
function normalize(body) {
  return body;
}
