import { daysAgo, startOfMonth } from '../lib/metrics.js';

const PRESETS = [
  { key: '7d', label: '7 days', range: () => ({ start: daysAgo(7), end: new Date() }) },
  { key: '30d', label: '30 days', range: () => ({ start: daysAgo(29), end: new Date() }) },
  { key: '90d', label: '90 days', range: () => ({ start: daysAgo(89), end: new Date() }) },
  { key: 'month', label: 'This month', range: () => ({ start: startOfMonth(), end: new Date() }) },
];

function toInput(d) {
  if (!d) return '';
  const x = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export default function DateRangeBar({ range, onChange }) {
  const active = PRESETS.find((p) => {
    const r = p.range();
    return toInput(r.start) === toInput(range.start) && toInput(r.end) === toInput(range.end);
  })?.key;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-md border border-line">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.range())}
            className={`px-2.5 py-1 text-xs transition ${
              active === p.key
                ? 'bg-elevated font-semibold text-fg'
                : 'bg-panel text-soft hover:bg-elevated/80 hover:text-fg'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        type="date"
        value={toInput(range.start)}
        onChange={(e) => onChange({ ...range, start: new Date(e.target.value + 'T00:00:00') })}
        className="field w-auto"
      />
      <span className="text-xs text-mute">to</span>
      <input
        type="date"
        value={toInput(range.end)}
        onChange={(e) => onChange({ ...range, end: new Date(e.target.value + 'T23:59:59') })}
        className="field w-auto"
      />
    </div>
  );
}
