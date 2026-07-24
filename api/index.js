// Single Express entry for nested /api/* paths.
// Non-Next Vercel projects do not support [...path] catch-alls beyond one segment,
// so vercel.json rewrites /api/(.*) → /api (this file). Dedicated files
// (health.js, webhooks/*.js) still win via filesystem routing.
import { app } from '../server/src/app.js';

export default app;
