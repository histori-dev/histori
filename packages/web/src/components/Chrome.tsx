import type { ReactNode } from "react";
import { Link } from "react-router";

const TABS = [
  { key: "sessions", label: "Sessions", to: "/" },
  { key: "memories", label: "Memories", to: "/memories" },
  { key: "rules", label: "Rules", to: "/rules" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

/** LoadCell-style app bar: logo mark left, centered segmented tabs, meta right. */
export function TopBar({ active, right }: { active: TabKey; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 h-12 border-b border-line bg-inset px-4 flex items-center">
      <Link to="/" className="flex items-center gap-2 shrink-0">
        <span className="w-5 h-5 rounded-[5px] bg-accent text-white grid place-items-center text-[10px] font-bold leading-none">
          h
        </span>
        <span className="font-semibold tracking-tight text-ink text-sm">histori</span>
      </Link>

      <nav className="absolute left-1/2 -translate-x-1/2 flex items-center bg-surface border border-line rounded-lg p-0.5">
        {TABS.map((t) =>
          t.key === active ? (
            <span
              key={t.key}
              className="px-3.5 py-1 text-xs font-medium text-ink bg-inset border border-line rounded-md shadow-sm"
            >
              {t.label}
            </span>
          ) : (
            <Link
              key={t.key}
              to={t.to}
              className="px-3.5 py-1 text-xs text-muted hover:text-ink transition-colors"
            >
              {t.label}
            </Link>
          ),
        )}
      </nav>

      <div className="ml-auto flex items-center gap-3 text-[11px] text-faint">{right}</div>
    </header>
  );
}

/** Tiny uppercase letterspaced label — the signature typographic element. */
export function Label({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`text-[10px] uppercase tracking-[0.14em] text-faint font-medium ${className}`}
    >
      {children}
    </p>
  );
}

/** Big number with a small muted unit suffix, e.g. 10.0|s or 1.4|ms. */
export function Metric({
  label,
  value,
  unit,
  tone,
  title,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: string;
  title?: string;
}) {
  return (
    <div title={title}>
      <Label>{label}</Label>
      <p
        className={`mt-0.5 text-xl font-semibold tracking-tight tabular-nums ${tone ?? "text-ink"}`}
      >
        {value}
        {unit && <span className="text-xs text-faint font-normal ml-0.5">{unit}</span>}
      </p>
    </div>
  );
}
