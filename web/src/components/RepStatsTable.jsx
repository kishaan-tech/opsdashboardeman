import { Fragment, useMemo, useState } from 'react';
import { moneyExact, extractNames } from '../lib/metrics.js';

function rateClass(r) {
  if (r >= 75) return 'bg-ok/15 text-ok';
  if (r >= 50) return 'bg-warn/15 text-warn';
  return 'bg-danger/15 text-danger';
}

function roleClass(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'closer') return 'bg-coral/15 text-coral';
  if (r === 'setter') return 'bg-brand/15 text-brand';
  if (r === 'both') return 'bg-ok/15 text-ok';
  return 'bg-elevated text-mute';
}

export default function RepStatsTable({ stats, transactions = [], bookings = [], loading }) {
  const [openId, setOpenId] = useState(null);

  const leadByBooking = useMemo(() => {
    const m = new Map();
    for (const b of bookings) m.set(b.id, b.lead_name || b.email || b.id);
    return m;
  }, [bookings]);

  if (loading) return <p className="p-4 text-sm text-mute">Loading reps…</p>;
  if (!stats.length) {
    return (
      <div className="rounded-2xl border border-line-soft bg-panel-2 p-8 text-center text-sm text-mute">
        No rep activity in this range.
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-line-soft bg-panel-2">
      <div className="border-b border-line-soft px-4 py-3">
        <p className="text-sm font-semibold">Rep performance</p>
        <p className="text-xs text-mute">Commission & close stats · click a row for breakdown</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-mute">
            <tr className="border-b border-line-soft">
              <th className="px-4 py-2.5 font-medium">#</th>
              <th className="px-4 py-2.5 font-medium">Rep</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 text-right font-medium">Calls set</th>
              <th className="px-4 py-2.5 text-right font-medium">On cal</th>
              <th className="px-4 py-2.5 text-right font-medium">Closes</th>
              <th className="px-4 py-2.5 text-right font-medium">Close rate</th>
              <th className="px-4 py-2.5 text-right font-medium">Commission</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {stats.map((rep, i) => {
              const open = openId === rep.id;
              const tx = transactions.filter(
                (t) =>
                  extractNames(t.set_by).includes(rep.name)
                  || extractNames(t.closed_by).includes(rep.name),
              );
              return (
                <Fragment key={rep.id}>
                  <tr
                    onClick={() => setOpenId(open ? null : rep.id)}
                    className="cursor-pointer transition hover:bg-elevated/40"
                  >
                    <td className="px-4 py-2.5 text-mute">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium">{rep.name}</td>
                    <td className="px-4 py-2.5">
                      <span className={`chip ${roleClass(rep.role)}`}>{rep.role}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{rep.callsSet}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{rep.callsOnCalendar}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{rep.closedDeals}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`chip ${rateClass(rep.closeRate)}`}>
                        {Math.round(rep.closeRate)}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <p className="font-semibold tabular-nums text-brand">{moneyExact(rep.commission)}</p>
                      {(rep.setterCommission > 0 || rep.closerCommission > 0) && (
                        <p className="text-[10px] text-mute">
                          {rep.setterCommission > 0 && <>Set {moneyExact(rep.setterCommission)}</>}
                          {rep.setterCommission > 0 && rep.closerCommission > 0 && ' · '}
                          {rep.closerCommission > 0 && <>Close {moneyExact(rep.closerCommission)}</>}
                        </p>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-ink-2">
                      <td colSpan={8} className="px-4 py-3">
                        {tx.length === 0 ? (
                          <p className="text-xs text-mute">No transactions attributed to this rep in range.</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead className="text-mute">
                              <tr>
                                <th className="py-1 text-left font-medium">Date</th>
                                <th className="py-1 text-left font-medium">Name</th>
                                <th className="py-1 text-left font-medium">Email</th>
                                <th className="py-1 text-left font-medium">Lead / booking</th>
                                <th className="py-1 text-right font-medium">Amount</th>
                                <th className="py-1 text-right font-medium">Set comm</th>
                                <th className="py-1 text-right font-medium">Close comm</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line-soft">
                              {tx.map((t) => (
                                <tr key={t.id}>
                                  <td className="py-1.5 text-soft">{t.date || '—'}</td>
                                  <td className="py-1.5 text-soft">{t.lead_name || '—'}</td>
                                  <td className="py-1.5 text-soft">{t.email || '—'}</td>
                                  <td className="py-1.5 text-soft">
                                    {t.booking_id
                                      ? (
                                        <a href={`#/entity/bookings/record/${t.booking_id}`} className="text-brand hover:underline">
                                          {leadByBooking.get(t.booking_id) || 'Booking'}
                                        </a>
                                      )
                                      : '—'}
                                  </td>
                                  <td className="py-1.5 text-right tabular-nums">{moneyExact(t.amount)}</td>
                                  <td className="py-1.5 text-right tabular-nums">
                                    {extractNames(t.set_by).includes(rep.name)
                                      ? moneyExact(t.setter_commission)
                                      : '—'}
                                  </td>
                                  <td className="py-1.5 text-right tabular-nums">
                                    {extractNames(t.closed_by).includes(rep.name)
                                      ? moneyExact(t.closer_commission)
                                      : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
