import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useOrg, scopeToOrg } from '../lib/org.jsx';

// Internal replacement for Typeform PCF (Xi0jVpJr).
// Writes onto the linked bookings row: showed_up, closed, objection,
// notes, cash_collected, revenue_generated, fathom_link.

const OBJECTIONS = ['None', 'Money', 'Fear', 'Other'];

export default function PostCallPage({ bookingId: bookingIdProp }) {
  const { activeOrgId } = useOrg();
  const [bookingId, setBookingId] = useState(bookingIdProp || '');
  const [booking, setBooking] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const [showedUp, setShowedUp] = useState(null); // true | false | null
  const [closed, setClosed] = useState(null);
  const [objection, setObjection] = useState('');
  const [notes, setNotes] = useState('');
  const [cashCollected, setCashCollected] = useState('');
  const [revenueGenerated, setRevenueGenerated] = useState('');
  const [fathomLink, setFathomLink] = useState('');

  const loadRecent = useCallback(async () => {
    if (!activeOrgId) return;
    const { data, error: err } = await scopeToOrg(
      supabase
        .from('bookings')
        .select('id, lead_name, email, email_calendly, start_time, showed_up, closed, status')
        .order('start_time', { ascending: false, nullsFirst: false })
        .limit(40),
      activeOrgId,
    );
    if (err) setError(err.message);
    else setRecent(data || []);
  }, [activeOrgId]);

  const loadBooking = useCallback(async (id) => {
    if (!id || !activeOrgId) {
      setBooking(null);
      return;
    }
    setLoading(true);
    setError(null);
    setSaved(false);
    const { data, error: err } = await scopeToOrg(
      supabase.from('bookings').select('*').eq('id', id),
      activeOrgId,
    ).maybeSingle();
    if (err) {
      setError(err.message);
      setBooking(null);
    } else if (!data) {
      setError('Booking not found');
      setBooking(null);
    } else {
      setBooking(data);
      setShowedUp(data.showed_up);
      setClosed(data.closed);
      setObjection(data.objection || '');
      setNotes(data.notes || '');
      setCashCollected(
        data.cash_collected == null || data.cash_collected === ''
          ? ''
          : String(data.cash_collected),
      );
      setRevenueGenerated(
        data.revenue_generated == null || data.revenue_generated === ''
          ? ''
          : String(data.revenue_generated),
      );
      setFathomLink(data.fathom_link || '');
    }
    setLoading(false);
  }, [activeOrgId]);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  useEffect(() => {
    setBookingId(bookingIdProp || '');
  }, [bookingIdProp]);

  useEffect(() => {
    if (bookingId) loadBooking(bookingId);
    else setBooking(null);
  }, [bookingId, loadBooking]);

  function pickBooking(id) {
    setBookingId(id);
    window.location.hash = `#/post-call/${id}`;
  }

  async function submit(e) {
    e.preventDefault();
    if (!booking?.id) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    const cash = cashCollected === '' ? null : Number(cashCollected);
    const rev = revenueGenerated === '' ? null : Number(revenueGenerated);
    if (cashCollected !== '' && Number.isNaN(cash)) {
      setError('Cash Collected must be a number (use 0 if no close)');
      setSaving(false);
      return;
    }
    if (revenueGenerated !== '' && Number.isNaN(rev)) {
      setError('Revenue Generated must be a number (use 0 if no close)');
      setSaving(false);
      return;
    }

    const patch = {
      showed_up: showedUp,
      closed,
      objection: objection || null,
      notes: notes || null,
      cash_collected: cash,
      revenue_generated: rev,
      fathom_link: fathomLink || null,
      form_link: `${window.location.origin}${window.location.pathname}#/post-call/${booking.id}`,
      updated_at: new Date().toISOString(),
    };

    const { data, error: err } = await supabase
      .from('bookings')
      .update(patch)
      .eq('id', booking.id)
      .select('*')
      .single();

    if (err) setError(err.message);
    else {
      setBooking(data);
      setSaved(true);
      loadRecent();
    }
    setSaving(false);
  }

  const email = booking?.email || booking?.email_calendly || '—';
  const needsPcf = (b) => b.showed_up == null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-line-soft px-6 pt-6 pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Post-call form</h2>
            <p className="mt-1 text-sm text-mute">
              Internal PCF — saves onto the booking (same fields as Typeform).
            </p>
          </div>
          {booking && (
            <a
              href={`#/entity/bookings/record/${booking.id}`}
              className="text-sm text-brand hover:underline"
            >
              Open booking →
            </a>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Booking picker */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-line-soft bg-panel-2">
          <p className="border-b border-line-soft px-4 py-3 text-xs font-medium uppercase tracking-wide text-mute">
            Recent bookings
          </p>
          <ul className="flex-1 overflow-y-auto">
            {recent.map((b) => {
              const active = b.id === bookingId;
              const pending = needsPcf(b);
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => pickBooking(b.id)}
                    className={`w-full border-b border-line-soft px-4 py-3 text-left transition ${
                      active ? 'bg-brand/10' : 'hover:bg-elevated/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-fg">
                        {b.lead_name || b.email || b.email_calendly || 'Untitled'}
                      </p>
                      {pending && (
                        <span className="chip shrink-0 bg-warn/15 text-warn">due</span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-mute">
                      {b.start_time
                        ? new Date(b.start_time).toLocaleString()
                        : 'No start time'}
                    </p>
                  </button>
                </li>
              );
            })}
            {!recent.length && (
              <li className="px-4 py-6 text-sm text-mute">No bookings yet.</li>
            )}
          </ul>
        </aside>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              {error}
            </div>
          )}
          {saved && (
            <div className="mb-4 rounded-xl border border-ok/30 bg-ok/10 p-3 text-sm text-ok">
              Saved to booking.
            </div>
          )}

          {!bookingId && (
            <p className="text-sm text-mute">
              Pick a booking on the left, or open this form from a booking’s detail panel.
            </p>
          )}

          {bookingId && loading && <p className="text-sm text-mute">Loading…</p>}

          {booking && !loading && (
            <form onSubmit={submit} className="mx-auto max-w-xl space-y-6">
              <div className="rounded-2xl border border-line-soft bg-panel-2 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-mute">Booking</p>
                <p className="mt-1 text-lg font-semibold tracking-tight">
                  {booking.lead_name || '—'}
                </p>
                <p className="text-sm text-mute">{email}</p>
                {booking.start_time && (
                  <p className="mt-1 text-xs text-mute">
                    {new Date(booking.start_time).toLocaleString()}
                  </p>
                )}
              </div>

              <YesNo
                label="Prospect show up?"
                value={showedUp}
                onChange={setShowedUp}
              />
              <YesNo
                label="Did they close?"
                value={closed}
                onChange={setClosed}
              />

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-fg">
                  What was the objection?
                </legend>
                <p className="mb-3 text-xs text-mute">(Even if you closed them)</p>
                <div className="flex flex-wrap gap-2">
                  {OBJECTIONS.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setObjection(o)}
                      className={`rounded-xl px-3 py-2 text-sm transition ${
                        objection === o
                          ? 'bg-brand font-semibold text-white'
                          : 'bg-elevated text-soft hover:text-fg'
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Any notes for the setter?</span>
                <textarea
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="field"
                  placeholder="Notes…"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Cash collected (from payments)</span>
                  <p className="mb-1.5 text-xs text-mute">(if no close type 0)</p>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={cashCollected}
                    onChange={(e) => setCashCollected(e.target.value)}
                    className="field"
                    placeholder="0"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">Revenue generated (deal / sub total)</span>
                  <p className="mb-1.5 text-xs text-mute">(if no close type 0)</p>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={revenueGenerated}
                    onChange={(e) => setRevenueGenerated(e.target.value)}
                    className="field"
                    placeholder="0"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">
                  Add your Fathom link for the call
                </span>
                <input
                  type="url"
                  value={fathomLink}
                  onChange={(e) => setFathomLink(e.target.value)}
                  className="field"
                  placeholder="https://fathom.video/…"
                />
              </label>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn btn-primary min-w-36">
                  {saving ? 'Saving…' : 'Submit PCF'}
                </button>
                <a
                  href={`#/entity/bookings/record/${booking.id}`}
                  className="text-sm text-mute hover:text-fg"
                >
                  Back to booking
                </a>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function YesNo({ label, value, onChange }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-fg">{label}</legend>
      <div className="flex gap-2">
        {[
          { v: true, label: 'Yes' },
          { v: false, label: 'No' },
        ].map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => onChange(opt.v)}
            className={`rounded-xl px-4 py-2 text-sm transition ${
              value === opt.v
                ? 'bg-brand font-semibold text-white'
                : 'bg-elevated text-soft hover:text-fg'
            }`}
          >
            {opt.label}
          </button>
        ))}
        {value != null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="px-2 text-xs text-mute hover:text-fg"
          >
            clear
          </button>
        )}
      </div>
    </fieldset>
  );
}
