# iClosed webhook fixtures

- `contact-created.official.json` / `call-booked.official.json` — shapes from [developer.iclosed.io](https://developer.iclosed.io) docs
- Older `contact-created.json` / `call-booked.json` — simplified samples

Run Eman E2E:

```bash
npm run smoke:iclosed-eman
# production:
SMOKE_BASE_URL=https://opsdashboarddooly.vercel.app npm run smoke:iclosed-eman
```
