import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { api, type Session } from "../api";
import { Label, Metric, TopBar } from "../components/Chrome";

type Range = "day" | "week" | "month" | "all";

const RANGES: { key: Range; label: string }[] = [
  { key: "day", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "month", label: "30 days" },
  { key: "all", label: "All time" },
];

function fmtDate(s: string) {
  return new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Wall-clock duration in hours. Sessions still open count up to now —
    unless they started over 24h ago, which means the Stop hook never fired
    (crash/kill); those have unknown duration and count as 0. */
function sessionHours(s: Session): number {
  const start = new Date(s.startedAt).getTime();
  if (!s.endedAt) {
    const elapsed = Date.now() - start;
    return elapsed < 24 * 3_600_000 ? Math.max(0, elapsed) / 3_600_000 : 0;
  }
  return Math.max(0, Math.min(new Date(s.endedAt).getTime() - start, 24 * 3_600_000)) / 3_600_000;
}

function fmtHours(h: number) {
  if (h === 0) return "0h";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  return `${h < 10 ? h.toFixed(1) : String(Math.round(h))}h`;
}

function shortDir(cwd: string) {
  return cwd.replace(/\\/g, "/").split("/").slice(-2).join("/");
}

function shortModel(model: string | null) {
  if (!model) return "—";
  return model.replace(/^claude-/, "").replace(/-\d{8}/, "");
}

/** Project identity: repo if known, else the last path segment of cwd. */
function projectOf(s: Session): string {
  if (s.repo) return s.repo;
  const seg = s.cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return seg[seg.length - 1] ?? s.cwd;
}

function rangeStart(range: Range): number | null {
  const now = new Date();
  if (range === "day") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === "week") return now.getTime() - 7 * 86_400_000;
  if (range === "month") return now.getTime() - 30 * 86_400_000;
  return null;
}

type Bucket = {
  label: string; // tooltip: "Jun 10 13:00"
  tick: string; // x-axis label, "" for unlabeled buckets
  added: number;
  removed: number;
  sessions: number; // sessions active during this bucket
  hours: number; // active time inside this bucket
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Hour-resolution buckets. A session is spread over every bucket it was
    active in (weighted by overlap), so a 13:00–17:00 session lights up four
    hourly bars — clusters of bars show when you were actually working. */
function buildBuckets(sessions: Session[], range: Range): Bucket[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // bucket width grows with the range so bars stay visible
  const spec =
    range === "day"
      ? { start: todayStart, ms: HOUR_MS, count: 24 }
      : range === "week"
        ? { start: todayStart - 6 * DAY_MS, ms: HOUR_MS, count: 7 * 24 }
        : range === "month"
          ? { start: todayStart - 29 * DAY_MS, ms: 6 * HOUR_MS, count: 30 * 4 }
          : { start: todayStart - 59 * DAY_MS, ms: 12 * HOUR_MS, count: 60 * 2 };

  const buckets: Bucket[] = Array.from({ length: spec.count }, (_, i) => {
    const t0 = spec.start + i * spec.ms;
    const d = new Date(t0);
    const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const hourStr = `${d.getHours()}:00`;
    let tick = "";
    if (range === "day") {
      if (d.getHours() % 3 === 0) tick = hourStr;
    } else {
      const tickDays = range === "week" ? 1 : 4;
      const dayIndex = Math.round((t0 - spec.start) / DAY_MS);
      if (d.getHours() === 0 && dayIndex % tickDays === 0) tick = dateStr;
    }
    return {
      label: range === "day" ? hourStr : `${dateStr} ${hourStr}`,
      tick,
      added: 0,
      removed: 0,
      sessions: 0,
      hours: 0,
    };
  });

  const end = spec.start + spec.count * spec.ms;
  for (const s of sessions) {
    const sStart = new Date(s.startedAt).getTime();
    // Stale sessions (unknown duration) collapse to a point at their start
    const sEnd = Math.max(sStart + 1, sStart + sessionHours(s) * HOUR_MS);
    const from = Math.max(spec.start, sStart);
    const to = Math.min(end, sEnd);
    if (from >= end || to <= spec.start) continue;
    const totalDur = Math.max(1, to - from);
    const i0 = Math.max(0, Math.floor((from - spec.start) / spec.ms));
    const i1 = Math.min(spec.count - 1, Math.floor((to - 1 - spec.start) / spec.ms));
    for (let i = i0; i <= i1; i++) {
      const b0 = spec.start + i * spec.ms;
      const overlap = Math.min(to, b0 + spec.ms) - Math.max(from, b0);
      if (overlap <= 0) continue;
      const b = buckets[i]!;
      const w = overlap / totalDur; // churn spread proportionally to time spent
      b.hours += overlap / HOUR_MS;
      b.added += s.linesAdded * w;
      b.removed += s.linesRemoved * w;
      b.sessions += 1;
    }
  }
  return buckets;
}

/** Monotone cubic interpolation (Fritsch–Carlson, like d3's curveMonotoneX):
    smooth between points, but stays flat where the data is flat — no overshoot. */
function monotoneD(pts: [number, number][]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  const x = pts.map((p) => p[0]);
  const y = pts.map((p) => p[1]);
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = x[i + 1]! - x[i]!;
    slope[i] = (y[i + 1]! - y[i]!) / dx[i]!;
  }
  const tang: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) {
    tang[i] = slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2;
  }
  tang[n - 1] = slope[n - 2]!;
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tang[i] = 0;
      tang[i + 1] = 0;
    } else {
      const a = tang[i]! / slope[i]!;
      const b = tang[i + 1]! / slope[i]!;
      const h = Math.hypot(a, b);
      if (h > 3) {
        tang[i] = ((3 / h) * a) * slope[i]!;
        tang[i + 1] = ((3 / h) * b) * slope[i]!;
      }
    }
  }
  let d = `M${x[0]!.toFixed(1)},${y[0]!.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = x[i]! + dx[i]! / 3;
    const c1y = y[i]! + (tang[i]! * dx[i]!) / 3;
    const c2x = x[i + 1]! - dx[i]! / 3;
    const c2y = y[i + 1]! - (tang[i + 1]! * dx[i]!) / 3;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${x[
      i + 1
    ]!.toFixed(1)},${y[i + 1]!.toFixed(1)}`;
  }
  return d;
}

/** Bar with rounded top corners only — rect rx rounds all four. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(2.5, w / 2, h);
  return `M${x.toFixed(1)},${(y + h).toFixed(1)} V${(y + r).toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)} H${(x + w - r).toFixed(1)} Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + r).toFixed(1)} V${(y + h).toFixed(1)} Z`;
}

/** Area sparkline with a soft sage gradient — the "throughput / tick" card. */
function Sparkline({ values }: { values: number[] }) {
  const W = 240;
  const H = 60;
  const p = 4;
  const max = Math.max(1, ...values);
  const pts: [number, number][] =
    values.length === 1
      ? [
          [p, H - p - (values[0]! / max) * (H - 2 * p)],
          [W - p, H - p - (values[0]! / max) * (H - 2 * p)],
        ]
      : values.map((v, i) => [
          p + (i * (W - 2 * p)) / (values.length - 1),
          H - p - (v / max) * (H - 2 * p),
        ]);
  const line = monotoneD(pts);
  const area = `${line} L${W - p},${H - p} L${p},${H - p} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-sage)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--color-sage)" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-fill)" />
      <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="1.25" />
    </svg>
  );
}

/** Big chart: clay bars (added) + brick bars (removed) on the left axis,
    sage bars (hours worked) on the right axis, and a smoothed sessions
    trend curve with soft area fill (values in the tooltips). */
function ChurnChart({ buckets }: { buckets: Bucket[] }) {
  const W = 960;
  const H = 320;
  const padL = 42;
  const padR = 36;
  const padT = 18;
  const padB = 24;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const baseY = padT + ih;
  const maxL = Math.max(1, ...buckets.map((b) => Math.max(b.added, b.removed)));
  const maxS = Math.max(1, ...buckets.map((b) => b.sessions));
  const maxH = Math.max(1, ...buckets.map((b) => b.hours));
  const slot = iw / buckets.length;
  const y = (v: number) => padT + ih - (v / maxL) * ih;
  const yS = (v: number) => padT + ih - (v / maxS) * ih * 0.92; // keep curve off the bar tops
  const yH = (v: number) => padT + ih - (v / maxH) * ih;
  // Overlay widths — bars share a center so clusters stay readable when thin
  const wHrs = Math.max(1.5, Math.min(26, slot * 0.78));
  const wAdd = Math.max(1.2, Math.min(17, slot * 0.5));
  const wSub = Math.max(1, Math.min(10, slot * 0.3));
  const showDots = buckets.length <= 31;
  const linePts: [number, number][] = buckets.map((b, i) => [
    padL + slot * i + slot / 2,
    yS(b.sessions),
  ]);
  const lineD = monotoneD(linePts);
  const areaD = `${lineD} L${(padL + iw - slot / 2).toFixed(1)},${baseY} L${(padL + slot / 2).toFixed(1)},${baseY} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full churn-chart" role="img">
      <defs>
        <linearGradient id="churn-sessions-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-sage)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--color-sage)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* axis captions, like "rps" / "ms" in LoadCell */}
      <text x={padL} y={10} fontSize="9" fill="var(--color-faint)">
        lines
      </text>
      <text x={W - padR} y={10} fontSize="9" fill="var(--color-faint)" textAnchor="end">
        hours
      </text>

      {[0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line
            x1={padL}
            x2={W - padR}
            y1={y(maxL * t)}
            y2={y(maxL * t)}
            stroke="var(--color-line)"
            strokeWidth="1"
            strokeDasharray="2 4"
          />
          <text
            x={padL - 6}
            y={y(maxL * t) + 3}
            fontSize="9"
            fill="var(--color-faint)"
            textAnchor="end"
          >
            {fmtTokens(Math.round(maxL * t))}
          </text>
          <text x={W - padR + 6} y={y(maxL * t) + 3} fontSize="9" fill="var(--color-faint)">
            {fmtHours(maxH * t)}
          </text>
        </g>
      ))}
      {/* solid baseline */}
      <line x1={padL} x2={W - padR} y1={baseY} y2={baseY} stroke="var(--color-line-strong)" />
      <text x={padL - 6} y={baseY + 3} fontSize="9" fill="var(--color-faint)" textAnchor="end">
        0
      </text>
      <text x={W - padR + 6} y={baseY + 3} fontSize="9" fill="var(--color-faint)">
        0
      </text>

      {/* sessions area sits behind the bars */}
      <path d={areaD} fill="url(#churn-sessions-fill)" />

      {buckets.map((b, i) => {
        const cx = padL + slot * i + slot / 2;
        return (
          <g key={i}>
            <rect
              className="slot-band"
              x={padL + slot * i}
              y={padT}
              width={slot}
              height={ih}
              rx="2"
            />
            {/* active-time band behind, churn bars layered in front */}
            {b.hours > 0 && (
              <path
                d={barPath(cx - wHrs / 2, yH(b.hours), wHrs, Math.max(2, baseY - yH(b.hours)))}
                fill="var(--color-sage)"
                opacity="0.55"
              />
            )}
            {b.added > 0.5 && (
              <path
                d={barPath(cx - wAdd / 2, y(b.added), wAdd, Math.max(2, baseY - y(b.added)))}
                fill="var(--color-bar)"
              />
            )}
            {b.removed > 0.5 && (
              <path
                d={barPath(cx - wSub / 2, y(b.removed), wSub, Math.max(2, baseY - y(b.removed)))}
                fill="var(--color-neg-strong)"
                opacity="0.75"
              />
            )}
            <rect x={padL + slot * i} y={padT} width={slot} height={ih} fill="transparent">
              <title>
                {`${b.label} — ${b.sessions} active session${b.sessions === 1 ? "" : "s"} · ${fmtHours(b.hours)} · +${Math.round(b.added)}/-${Math.round(b.removed)} lines`}
              </title>
            </rect>
            {b.tick && (
              <>
                <line
                  x1={padL + slot * i}
                  x2={padL + slot * i}
                  y1={baseY}
                  y2={baseY + 4}
                  stroke="var(--color-line-strong)"
                />
                <text
                  x={padL + slot * i + 2}
                  y={H - 7}
                  fontSize="9"
                  fill="var(--color-faint)"
                >
                  {b.tick}
                </text>
              </>
            )}
          </g>
        );
      })}

      <path
        d={lineD}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      {/* dots only where something happened — anchors the curve to real data */}
      {showDots &&
        buckets.map((b, i) =>
          b.sessions > 0 ? (
          <circle
            key={i}
            cx={padL + slot * i + slot / 2}
            cy={yS(b.sessions)}
            r="2"
            fill="var(--color-accent)"
            stroke="var(--color-surface)"
            strokeWidth="1"
          />
        ) : null,
      )}
    </svg>
  );
}

function LegendChip({ swatch, children }: { swatch: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-inset border border-line rounded px-2 py-0.5 text-[10px] text-muted">
      <span className="w-2 h-2 rounded-[2px]" style={{ background: swatch }} />
      {children}
    </span>
  );
}

export default function SessionsPage() {
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [results, setResults] = useState<Session[] | null>(null);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<Range>(() => {
    const q = new URLSearchParams(window.location.search).get("range");
    return RANGES.some((r) => r.key === q) ? (q as Range) : "day";
  });
  const [project, setProject] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api
      .sessions()
      .then(setAllSessions)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  function onSearch(q: string) {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    if (!q.trim()) {
      setResults(null);
      return;
    }
    debounce.current = setTimeout(() => {
      setSearching(true);
      api
        .search(q.trim())
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
  }

  // Range-filtered (but not project-filtered) base — drives the project sidebar.
  // A session counts if it was ACTIVE in the range, not just started in it —
  // a session running past midnight still belongs to "Today".
  const inRange = useMemo(() => {
    const base = results ?? allSessions;
    const start = rangeStart(range);
    return start === null
      ? base
      : base.filter(
          (s) => new Date(s.startedAt).getTime() + sessionHours(s) * HOUR_MS >= start,
        );
  }, [results, allSessions, range]);

  const projectStats = useMemo(() => {
    const map = new Map<string, { sessions: number; added: number; removed: number }>();
    for (const s of inRange) {
      const p = projectOf(s);
      const cur = map.get(p) ?? { sessions: 0, added: 0, removed: 0 };
      cur.sessions += 1;
      cur.added += s.linesAdded;
      cur.removed += s.linesRemoved;
      map.set(p, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].sessions - a[1].sessions);
  }, [inRange]);

  const filtered = useMemo(
    () => (project === "all" ? inRange : inRange.filter((s) => projectOf(s) === project)),
    [inRange, project],
  );

  const buckets = useMemo(() => buildBuckets(filtered, range), [filtered, range]);

  const stats = useMemo(
    () => ({
      sessions: filtered.length,
      files: filtered.reduce((s, r) => s + r.filesChanged, 0),
      added: filtered.reduce((s, r) => s + r.linesAdded, 0),
      removed: filtered.reduce((s, r) => s + r.linesRemoved, 0),
      tokens: filtered.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0),
      cost: filtered.reduce((s, r) => s + r.costUsd, 0),
    }),
    [filtered],
  );

  // Active time clipped to the range — a session straddling midnight only
  // contributes its in-range hours.
  const rangeHours = useMemo(() => buckets.reduce((s, b) => s + b.hours, 0), [buckets]);

  const churnTotal = stats.added + stats.removed;
  const addedShare = churnTotal ? (stats.added / churnTotal) * 100 : 0;
  const hasChurn = buckets.some((b) => b.added || b.removed || b.hours);
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? "";
  const maxBucketSessions = Math.max(0, ...buckets.map((b) => b.sessions));

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar
        active="sessions"
        right={
          <span>
            {allSessions.length} session{allSessions.length === 1 ? "" : "s"}
          </span>
        }
      />

      <div className="flex flex-1 min-h-0">
        {/* Sidebar — saved-runs style: search, range, project cards */}
        <aside className="w-60 shrink-0 border-r border-line px-3 py-4 space-y-6 hidden md:block">
          <div>
            <input
              type="search"
              value={query}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search sessions…"
              className="w-full bg-inset border border-line rounded-md px-2.5 py-1.5 text-xs text-ink placeholder-faint outline-none focus:border-line-strong focus:ring-2 focus:ring-sage-tint transition-colors"
            />
            {searching && <p className="text-faint text-[10px] mt-1.5 px-1">Searching…</p>}
          </div>

          <section>
            <Label className="px-1 mb-2">Time range</Label>
            <div className="flex flex-wrap gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={`px-2.5 py-1 text-[11px] rounded-md border transition-colors ${
                    range === r.key
                      ? "bg-inset border-line shadow-sm text-ink font-medium"
                      : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between px-1 mb-2">
              <Label>Projects</Label>
              <span className="text-[10px] text-faint tabular-nums">{projectStats.length}</span>
            </div>
            <div className="space-y-1">
              <button
                onClick={() => setProject("all")}
                className={`w-full text-left px-2.5 py-2 rounded-md border transition-colors ${
                  project === "all"
                    ? "bg-inset border-line shadow-sm"
                    : "border-transparent hover:bg-inset/60"
                }`}
              >
                <span className="text-xs font-medium text-ink">All projects</span>
                <p className="text-[10px] text-faint mt-0.5 tabular-nums">
                  {inRange.length} session{inRange.length === 1 ? "" : "s"}
                </p>
              </button>
              {projectStats.map(([p, st]) => (
                <button
                  key={p}
                  onClick={() => setProject(project === p ? "all" : p)}
                  className={`w-full text-left px-2.5 py-2 rounded-md border transition-colors ${
                    project === p
                      ? "bg-inset border-line shadow-sm"
                      : "border-transparent hover:bg-inset/60"
                  }`}
                >
                  <span className="text-xs font-medium text-ink truncate block" title={p}>
                    {p}
                  </span>
                  <p className="text-[10px] text-faint mt-0.5 tabular-nums">
                    {st.sessions} session{st.sessions === 1 ? "" : "s"}
                    {st.added + st.removed > 0 && (
                      <span className="font-mono ml-1.5">
                        <span className="text-pos">+{fmtTokens(st.added)}</span>
                        <span className="text-faint">/</span>
                        <span className="text-neg">-{fmtTokens(st.removed)}</span>
                      </span>
                    )}
                  </p>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <main className="flex-1 min-w-0 p-4 space-y-4">
          {loading && <p className="text-muted text-sm">Loading...</p>}
          {error && <p className="text-neg-strong text-sm">{error}</p>}

          {!loading && !error && (
            <>
              {/* Hero metrics strip */}
              <div className="bg-inset border border-line rounded-lg shadow-sm flex flex-wrap">
                <div className="px-5 py-4 w-60 border-r border-line">
                  <Label>Lines changed</Label>
                  <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-ink">
                    {fmtTokens(churnTotal)}
                    <span className="text-sm text-faint font-normal ml-1">lines</span>
                  </p>
                  <div className="mt-3 h-1.5 rounded-full bg-surface overflow-hidden flex">
                    <div className="bg-pos-soft" style={{ width: `${addedShare}%` }} />
                    <div className="bg-neg-strong" style={{ width: `${100 - addedShare}%` }} />
                  </div>
                  <p className="mt-2 text-[10px] text-muted tabular-nums">
                    <span className="text-pos-soft">■</span> added{" "}
                    {churnTotal ? addedShare.toFixed(0) : 0}%
                    <span className="text-neg-strong ml-2">■</span> removed{" "}
                    {churnTotal ? (100 - addedShare).toFixed(0) : 0}%
                  </p>
                </div>

                <div className="flex-1 min-w-[280px] px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-4 border-r border-line content-center">
                  <Metric label="Sessions" value={stats.sessions} />
                  <Metric
                    label="Hours"
                    value={fmtHours(rangeHours)}
                    title="Session time spent inside this range — overlapping sessions all count"
                  />
                  <Metric label="Files touched" value={stats.files} />
                  <Metric label="Tokens" value={fmtTokens(stats.tokens)} />
                  <Metric label="Added" value={`+${fmtTokens(stats.added)}`} tone="text-pos" />
                  <Metric label="Removed" value={`-${fmtTokens(stats.removed)}`} tone="text-neg" />
                  <Metric
                    label="Est. API value"
                    value={`$${stats.cost.toFixed(2)}`}
                    tone="text-warm"
                    title="What this usage would cost at API prices. On a subscription plan (Pro/Max) you pay a flat fee — read this as the value you extracted."
                  />
                </div>

                <div className="w-72 px-5 py-4">
                  <div className="flex items-center justify-between">
                    <Label>Activity / {rangeLabel}</Label>
                    <span className="text-[10px] text-faint tabular-nums">
                      0 — {maxBucketSessions}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Sparkline values={buckets.map((b) => b.sessions)} />
                  </div>
                </div>
              </div>

              {/* Big chart on the tinted panel */}
              <div className="bg-surface border border-line rounded-lg shadow-sm p-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex gap-1.5 flex-wrap">
                    <LegendChip swatch="var(--color-bar)">added / bucket</LegendChip>
                    <LegendChip swatch="var(--color-neg-strong)">removed / bucket</LegendChip>
                    <LegendChip swatch="var(--color-sage)">active hours</LegendChip>
                    <LegendChip swatch="var(--color-accent)">active sessions</LegendChip>
                  </div>
                  <Label>Code churn / {rangeLabel}</Label>
                </div>
                {hasChurn ? (
                  <ChurnChart buckets={buckets} />
                ) : (
                  <p className="text-faint text-xs py-16 text-center">
                    No code changes in this range.
                  </p>
                )}
              </div>

              {/* Sessions table */}
              {filtered.length === 0 ? (
                <div className="text-center py-14 text-muted">
                  <p className="text-sm">
                    {allSessions.length === 0 ? "No sessions yet." : "No sessions in this range."}
                  </p>
                  <p className="text-xs mt-1 text-faint">
                    {allSessions.length === 0 ? (
                      <>
                        Run <code className="text-ink bg-surface px-1 rounded">histori up</code>{" "}
                        and start a Claude Code session.
                      </>
                    ) : (
                      "Try a wider time range or a different project."
                    )}
                  </p>
                </div>
              ) : (
                <div className="border border-line rounded-lg bg-inset shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-faint border-b border-line bg-surface/60">
                        <th className="py-2.5 px-4 font-medium">Date</th>
                        <th className="py-2.5 pr-4 font-medium">Directory</th>
                        <th className="py-2.5 pr-4 font-medium">Changes</th>
                        <th className="py-2.5 pr-4 font-medium">Model</th>
                        <th className="py-2.5 pr-4 font-medium text-right">Tokens</th>
                        <th
                          className="py-2.5 pr-4 font-medium text-right"
                          title="API-equivalent value of the usage — on Pro/Max you pay a flat subscription, not this amount"
                        >
                          Value
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((s) => (
                        <tr
                          key={s.id}
                          className="border-b border-line last:border-0 hover:bg-surface/70 transition-colors"
                        >
                          <td className="py-3 px-4 text-muted whitespace-nowrap text-xs">
                            {fmtDate(s.startedAt)}
                          </td>
                          <td className="py-3 pr-4 max-w-xs">
                            <Link
                              to={`/sessions/${s.id}`}
                              className="text-ink hover:text-accent font-medium transition-colors truncate block"
                            >
                              {shortDir(s.cwd)}
                            </Link>
                            {s.repo && (
                              <span className="text-faint text-xs">
                                {s.repo}
                                {s.branch ? `@${s.branch}` : ""}
                              </span>
                            )}
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap">
                            {s.filesChanged > 0 ? (
                              <span className="text-xs">
                                <span className="text-muted">
                                  {s.filesChanged} file{s.filesChanged === 1 ? "" : "s"}
                                </span>{" "}
                                <span className="font-mono">
                                  <span className="text-pos">+{s.linesAdded}</span>
                                  <span className="text-faint">/</span>
                                  <span className="text-neg">-{s.linesRemoved}</span>
                                </span>
                              </span>
                            ) : (
                              <span className="text-faint text-xs">—</span>
                            )}
                          </td>
                          <td className="py-3 pr-4 text-faint text-xs whitespace-nowrap">
                            {shortModel(s.model)}
                          </td>
                          <td className="py-3 pr-4 text-right text-muted tabular-nums">
                            {fmtTokens(s.inputTokens + s.outputTokens)}
                          </td>
                          <td className="py-3 pr-4 text-right tabular-nums">
                            <span
                              className={
                                s.costUsd > 1
                                  ? "text-warm font-medium"
                                  : s.costUsd > 0
                                    ? "text-accent"
                                    : "text-faint"
                              }
                            >
                              ${s.costUsd.toFixed(4)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
