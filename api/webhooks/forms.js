// Explicit Vercel routes — catch-all does not reliably serve /api/webhooks/*.
import { app } from '../../server/src/app.js';

export default app;
