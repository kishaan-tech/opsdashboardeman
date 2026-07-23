// Vercel catch-all — serves /api/webhooks/* (and other /api/* except health.js).
// Local: npm run api → server/src/server.js on :8787
import { app } from '../server/src/app.js';

export default app;
