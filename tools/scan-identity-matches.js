#!/usr/bin/env node
// Backfill same-person flags across all leads.
// Usage: node tools/scan-identity-matches.js
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const { scanAllIdentityMatches } = await import('../server/src/lib/identity.js');

const result = await scanAllIdentityMatches();
console.log(result);
