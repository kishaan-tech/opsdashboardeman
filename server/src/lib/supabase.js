import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

// Never process.exit here — on Vercel that kills the whole serverless
// function (including /api/health) before a request is handled.
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in .env locally, or Vercel → Settings → Environment Variables)',
  );
}

// Service-role client: bypasses RLS. Server-side only — never ship this key
// to the browser. Proxy so health can boot even when env is missing;
// webhook routes still fail clearly when they touch supabase.
export const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : new Proxy(
        {},
        {
          get() {
            throw new Error(
              'Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
            );
          },
        },
      );
