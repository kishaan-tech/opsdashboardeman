// Client-side metrics for Performance / Commissions / charts.
// Ported from the Brand Academy dashboard (dooly-dashboard) onto ops-hub schema.

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function daysAgo(n) {
  const d = startOfDay(new Date());
  d.setDate(d.getDate() - n);
  return d;
}

export function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeRange(range) {
  if (!range?.start || !range?.end) return null;
  const start = startOfDay(range.start);
  const end = endOfDay(range.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return start <= end ? { start, end } : { start: end, end: start };
}

function inRange(date, range) {
  if (!date) return false;
  return date >= range.start && date <= range.end;
}

function safePercent(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 10000) / 100;
}

/** Pull display names from text or jsonb lookup snapshots. */
export function extractNames(field) {
  if (field == null || field === '') return [];
  if (typeof field === 'string') return [field];
  if (Array.isArray(field)) return field.flatMap(extractNames).filter(Boolean);
  if (typeof field === 'object') {
    const n = field.name ?? field.rep_name ?? field.label ?? field.value;
    return n ? [String(n)] : [];
  }
  return [];
}

export function repsById(reps) {
  const map = new Map();
  for (const r of reps || []) map.set(r.id, r);
  return map;
}

export function bookingSetterName(b, byId) {
  if (b.set_by) return String(b.set_by);
  if (b.set_by_id && byId.get(b.set_by_id)?.rep_name) return byId.get(b.set_by_id).rep_name;
  return '';
}

export function bookingCloserName(b, byId) {
  if (b.closer_id && byId.get(b.closer_id)?.rep_name) return byId.get(b.closer_id).rep_name;
  if (b.sales_reps) return String(b.sales_reps);
  return '';
}

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

function mondayOf(d) {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
}

export function getBookingsPerDay(bookings, range) {
  const normal = normalizeRange(range);
  if (!normal) return [];
  const counts = new Map();
  for (const b of bookings) {
    const d = parseDate(b.start_time);
    if (!inRange(d, normal)) continue;
    const key = isoDay(d);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const out = [];
  for (let t = startOfDay(normal.start).getTime(); t <= normal.end.getTime(); t += 86400000) {
    const d = new Date(t);
    const key = isoDay(d);
    out.push({
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      isoDate: key,
      value: counts.get(key) || 0,
    });
  }
  return out;
}

export function getCashPerDay(transactions, range) {
  const normal = normalizeRange(range);
  if (!normal) return [];
  const amounts = new Map();
  for (const t of transactions) {
    const d = parseDate(t.date);
    if (!inRange(d, normal)) continue;
    const key = isoDay(d);
    amounts.set(key, (amounts.get(key) || 0) + (Number(t.amount) || 0));
  }
  const out = [];
  for (let t = startOfDay(normal.start).getTime(); t <= normal.end.getTime(); t += 86400000) {
    const d = new Date(t);
    const key = isoDay(d);
    out.push({
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      isoDate: key,
      value: amounts.get(key) || 0,
    });
  }
  return out;
}

export function getCashPerWeek(transactions, range) {
  const normal = normalizeRange(range);
  if (!normal) return [];
  const amounts = new Map();
  for (const t of transactions) {
    const d = parseDate(t.date);
    if (!inRange(d, normal)) continue;
    const key = isoDay(mondayOf(d));
    amounts.set(key, (amounts.get(key) || 0) + (Number(t.amount) || 0));
  }
  return [...amounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => ({
      label: new Date(key + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      isoDate: key,
      value,
    }));
}

/**
 * Rep performance + commission, matching Brand Academy dashboard logic.
 */
export function calculateRepStats(reps, bookings, transactions, range) {
  const normal = normalizeRange(range);
  if (!normal) return [];
  const byId = repsById(reps);

  const filteredBookings = bookings.filter((b) => inRange(parseDate(b.start_time), normal));
  const filteredTx = transactions.filter((t) => inRange(parseDate(t.date), normal));

  return (reps || [])
    .map((rep) => {
      const name = rep.rep_name || '';
      const callsSet = filteredBookings.filter((b) => bookingSetterName(b, byId) === name).length;
      const callsOnCalendar = filteredBookings.filter(
        (b) => bookingSetterName(b, byId) === name && b.showed_up,
      ).length;
      const repShows = filteredBookings.filter(
        (b) => bookingCloserName(b, byId) === name && b.showed_up,
      ).length;
      const closedDeals = filteredBookings.filter(
        (b) => bookingCloserName(b, byId) === name && b.closed,
      ).length;

      const setterCommission = filteredTx
        .filter((t) => extractNames(t.set_by).includes(name))
        .reduce((sum, t) => sum + (Number(t.setter_commission) || 0), 0);
      const closerCommission = filteredTx
        .filter((t) => extractNames(t.closed_by).includes(name))
        .reduce((sum, t) => sum + (Number(t.closer_commission) || 0), 0);

      return {
        id: rep.id,
        name,
        role: rep.role || '—',
        callsSet,
        callsOnCalendar,
        closedDeals,
        closeRate: safePercent(closedDeals, repShows),
        setterCommission,
        closerCommission,
        commission: setterCommission + closerCommission,
      };
    })
    .filter((r) => r.callsSet > 0 || r.closedDeals > 0 || r.commission > 0)
    .sort((a, b) => b.commission - a.commission);
}

/** Past bookings with no showed_up filled = overdue PCF. */
export function overduePcfs(bookings, byId) {
  const now = new Date();
  return (bookings || [])
    .filter((b) => {
      const start = parseDate(b.start_time);
      if (!start || start >= now) return false;
      return b.showed_up == null;
    })
    .sort((a, b) => {
      const ta = parseDate(a.start_time)?.getTime() || 0;
      const tb = parseDate(b.start_time)?.getTime() || 0;
      return tb - ta;
    })
    .map((b) => ({
      ...b,
      setByName: bookingSetterName(b, byId),
      closerName: bookingCloserName(b, byId),
    }));
}

export const money = (n) =>
  '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

export const moneyExact = (n) =>
  (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
