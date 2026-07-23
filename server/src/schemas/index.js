// Zod schemas for inbound payloads. These are OUR canonical shapes — vendor
// translation lives in api/src/lib/vendors/, so swapping vendors never touches
// the ingest pipeline.

import { z } from 'zod';

const dateish = z.string().min(4); // ISO datetime preferred; Date.parse-able accepted

export const formSubmissionSchema = z.object({
  form_name: z.string().min(1),
  submission_id: z.string().min(1),          // vendor's id — powers idempotency
  email: z.string().email(),                 // required: a form lead without email is unmatchable
  name: z.string().optional(),
  phone: z.string().optional(),
  source: z.string().optional(),             // e.g. 'typeform - vsl page'
  answers: z.record(z.unknown()).optional(),
  form_response_url: z.string().optional(),
});

export const bookingSchema = z.object({
  booking_id: z.string().min(1),
  starts_at: dateish,
  status: z.string().min(1).default('Scheduled'),
  email: z.string().email(),
  name: z.string().optional(),
  phone: z.string().optional(),
  event_name: z.string().optional(),
  // Calendly tracking.* — used to resolve set_by / closer against sales_reps
  utm: z.object({
    utm_source: z.string().nullable().optional(),
    utm_medium: z.string().nullable().optional(),
    utm_campaign: z.string().nullable().optional(),
    utm_content: z.string().nullable().optional(),
    utm_term: z.string().nullable().optional(),
  }).optional(),
});

export const paymentSchema = z.object({
  payment_id: z.string().min(1),
  amount: z.coerce.number().nonnegative(),   // major units, e.g. 800 or 800.50
  status: z.string().min(1).default('succeeded'),
  paid_at: dateish.optional(),
  email: z.string().email().optional(),
  name: z.string().optional(),
});
