import { money } from '../lib/metrics.js';

function BarChart({ title, subtitle, series, formatValue = (v) => String(v), color = 'bg-brand' }) {
  const max = Math.max(1, ...series.map((s) => s.value));
  return (
    <section className="rounded-2xl border border-line-soft bg-panel-2 p-4">
      <div className="mb-4">
        <p className="text-sm font-semibold tracking-tight">{title}</p>
        {subtitle && <p className="mt-0.5 text-xs text-mute">{subtitle}</p>}
      </div>
      {series.length === 0 ? (
        <p className="py-8 text-center text-sm text-mute">No data in range</p>
      ) : (
        <div className="flex h-40 items-end gap-1 overflow-x-auto pb-1">
          {series.map((s) => (
            <div key={s.isoDate} className="group flex min-w-[10px] flex-1 flex-col items-center justify-end">
              <div
                className={`w-full max-w-6 rounded-t-md ${color} opacity-90 transition group-hover:opacity-100`}
                style={{ height: `${Math.max(2, (s.value / max) * 100)}%` }}
                title={`${s.label}: ${formatValue(s.value)}`}
              />
            </div>
          ))}
        </div>
      )}
      {series.length > 0 && (
        <div className="mt-2 flex justify-between text-[10px] text-mute">
          <span>{series[0].label}</span>
          <span>{series[series.length - 1].label}</span>
        </div>
      )}
    </section>
  );
}

export default function PerfCharts({ bookingsPerDay, cashPerWeek, cashPerDay, loading }) {
  if (loading) {
    return <p className="text-sm text-mute">Loading charts…</p>;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <BarChart
        title="Bookings per day"
        subtitle="Appointments scheduled"
        series={bookingsPerDay}
        color="bg-brand"
      />
      <BarChart
        title="Cash collected per week"
        subtitle="Mon–Sun weeks"
        series={cashPerWeek}
        formatValue={money}
        color="bg-teal"
      />
      <BarChart
        title="Cash collected per day"
        subtitle="Daily revenue"
        series={cashPerDay}
        formatValue={money}
        color="bg-coral"
      />
    </div>
  );
}
