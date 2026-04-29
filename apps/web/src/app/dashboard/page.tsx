import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: sessions } = await supabase
    .from("share_sessions")
    .select(
      "id, room_id, mode, started_at, ended_at, duration_sec, peak_viewer_count, was_recorded, remote_control_used",
    )
    .order("started_at", { ascending: false })
    .limit(50);

  const totalSessions = sessions?.length ?? 0;
  const totalDurationSec = (sessions ?? []).reduce(
    (acc, s) => acc + (s.duration_sec ?? 0),
    0,
  );
  const totalViewers = (sessions ?? []).reduce(
    (acc, s) => acc + (s.peak_viewer_count ?? 0),
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-2xl font-bold text-surface-dark">Dashboard</h1>
        <p className="text-sm text-surface-muted mt-1">
          Your share history and recordings.
        </p>
      </section>

      <section className="grid grid-cols-3 gap-3">
        <Stat label="Total sessions" value={String(totalSessions)} />
        <Stat label="Total time shared" value={formatHMS(totalDurationSec)} />
        <Stat label="Peak viewers" value={String(totalViewers)} />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-surface-dark mb-3">
          Recent sessions
        </h2>

        {totalSessions === 0 ? (
          <EmptyState />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-left text-xs uppercase tracking-wide text-surface-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Started</th>
                  <th className="px-4 py-3 font-medium">Mode</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">Viewers</th>
                  <th className="px-4 py-3 font-medium">Features</th>
                </tr>
              </thead>
              <tbody>
                {sessions!.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50"
                  >
                    <td className="px-4 py-3 text-surface-dark">
                      {formatDate(s.started_at)}
                    </td>
                    <td className="px-4 py-3 text-surface-muted">
                      {s.mode === "tab" ? "Tab" : "Screen / window / tab"}
                    </td>
                    <td className="px-4 py-3 text-surface-muted">
                      {s.duration_sec ? formatHMS(s.duration_sec) : "—"}
                    </td>
                    <td className="px-4 py-3 text-surface-muted">
                      {s.peak_viewer_count}
                    </td>
                    <td className="px-4 py-3 text-surface-muted">
                      {s.was_recorded && (
                        <Pill color="red" label="Recorded" />
                      )}
                      {s.remote_control_used && (
                        <Pill color="amber" label="Control" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-xs uppercase tracking-wide text-surface-muted font-semibold">
        {label}
      </p>
      <p className="text-2xl font-bold text-surface-dark mt-1">{value}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center">
      <div className="w-12 h-12 mx-auto rounded-lg bg-gradient-to-br from-brand-100 to-accent-100 flex items-center justify-center mb-4">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#4F46E5"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      </div>
      <h3 className="font-semibold text-surface-dark">
        No sessions yet
      </h3>
      <p className="text-sm text-surface-muted mt-1 max-w-sm mx-auto">
        Install the OneClickCast Chrome extension and start sharing — your
        sessions will show up here.
      </p>
      <a
        href="/"
        className="mt-4 inline-flex items-center gap-2 bg-gradient-to-r from-brand-600 to-accent-500 hover:from-brand-700 hover:to-accent-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
      >
        Get the extension
      </a>
    </div>
  );
}

function Pill({
  color,
  label,
}: {
  color: "red" | "amber" | "emerald";
  label: string;
}) {
  const cls =
    color === "red"
      ? "bg-red-50 text-red-700 border-red-200"
      : color === "amber"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-emerald-50 text-emerald-700 border-emerald-200";
  return (
    <span
      className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded border ${cls} mr-1`}
    >
      {label}
    </span>
  );
}

function formatHMS(sec: number): string {
  if (!sec || sec <= 0) return "0m";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
