// Lightweight health probe — no Express / Supabase imports so it always boots.
export default function handler(_req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({
    ok: true,
    runtime: 'vercel',
    service: 'ops-hub',
  }));
}
