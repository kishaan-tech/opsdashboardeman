// Shared helpers for flat / nested contact fields on form webhooks.

import { createHash } from 'node:crypto';

export function dig(obj, ...paths) {
  for (const path of paths) {
    if (!path) continue;
    if (typeof path === 'string' && !path.includes('.') && obj && typeof obj === 'object') {
      if (obj[path] != null && obj[path] !== '') return obj[path];
      continue;
    }
    const parts = String(path).split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') { cur = undefined; break; }
      cur = cur[p];
    }
    if (cur != null && cur !== '') return cur;
  }
  return undefined;
}

export function asEmail(v) {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  return s.includes('@') ? s : undefined;
}

export function asPhone(v) {
  if (v == null || v === '') return undefined;
  return String(v).trim() || undefined;
}

export function fullName(first, last, fallback) {
  const joined = [first, last].filter(Boolean).map(String).join(' ').trim();
  if (joined) return joined;
  if (fallback != null && String(fallback).trim()) return String(fallback).trim();
  return undefined;
}

export function findEmailDeep(body) {
  const direct = asEmail(dig(
    body,
    'email',
    'Email',
    'email_address',
    'emailAddress',
    'contact.email',
    'contact.Email',
    'data.email',
    'user.email',
    'attendee.email',
    'registrant.email',
  ));
  if (direct) return direct;
  if (!body || typeof body !== 'object') return undefined;
  for (const [k, v] of Object.entries(body)) {
    if (/email/i.test(k) && typeof v === 'string' && v.includes('@')) return v.trim().toLowerCase();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = findEmailDeep(v);
      if (nested) return nested;
    }
  }
  return undefined;
}

export function findNameDeep(body) {
  const first = dig(body, 'first_name', 'firstName', 'firstname', 'contact.first_name', 'contact.firstName', 'data.first_name', 'user.first_name');
  const last = dig(body, 'last_name', 'lastName', 'lastname', 'contact.last_name', 'contact.lastName', 'data.last_name', 'user.last_name');
  const name = fullName(first, last, dig(
    body,
    'name',
    'full_name',
    'fullName',
    'contact.name',
    'contact.full_name',
    'data.name',
    'user.name',
  ));
  return name;
}

export function findPhoneDeep(body) {
  return asPhone(dig(
    body,
    'phone',
    'Phone',
    'phone_number',
    'phoneNumber',
    'contact.phone',
    'contact.phone_number',
    'data.phone',
    'user.phone',
    'mobile',
  ));
}

export function hashSubmissionId(...parts) {
  return createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 24);
}
