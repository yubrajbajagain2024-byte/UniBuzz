/**
 * The review queue's building blocks, as the website's console has them (apps/web/src/components/staff/parts.tsx): the
 * severity rail, highlighted spans, and Buzz excerpts inside a Phosphor chip-frame with the mask glyph (never an
 * avatar, never an alias unless the blind thread context gives one).
 */
import type { CSSProperties, ReactNode } from "react";
import { ShieldAlert, VenetianMask } from "lucide-react";
import { BUZZ_PHOSPHOR } from "@apartment-book/shared";
import type { ModerationPriority, ModerationSeverity } from "@/lib/console/queue-types";
import { cn } from "@/lib/utils";
import type { Tone } from "@/components/console/parts";

export const PRIORITY_TONE: Record<ModerationPriority, Tone> = { p0: "red", p1: "amber", p2: "blue", p3: "gray" };
export const ROLE_TONE: Record<string, Tone> = { admin: "amber", moderator: "blue", campus_admin: "violet", system: "gray", user: "gray" };

/** The left rail of a queue card: how severe the engine (or the reports) think it is. */
export const SEVERITY_RAIL: Record<ModerationSeverity, string> = {
  none: "border-l-gray-300",
  low: "border-l-sky-400",
  medium: "border-l-amber-400",
  high: "border-l-red-500",
  critical: "border-l-red-600",
};

/** `[start, end)` spans of the original text, marked. */
export function HighlightedText({ text, spans, markClassName, markStyle }: { text: string; spans?: [number, number][]; markClassName?: string; markStyle?: CSSProperties }) {
  if (!spans || spans.length === 0) return <>{text}</>;
  const sorted = spans.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b > a && a < text.length).sort((x, y) => x[0] - y[0]);
  const out: ReactNode[] = [];
  let cursor = 0;
  sorted.forEach(([a, b], i) => {
    const start = Math.max(a, cursor);
    const end = Math.min(b, text.length);
    if (start > cursor) out.push(<span key={`t${i}`}>{text.slice(cursor, start)}</span>);
    if (end > start)
      out.push(
        <mark key={`m${i}`} className={cn("rounded px-0.5", markClassName)} style={markStyle}>
          {text.slice(start, end)}
        </mark>,
      );
    cursor = Math.max(cursor, end);
  });
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{out}</>;
}

const P = BUZZ_PHOSPHOR;

/**
 * An excerpt. Buzz (anon) text sits inside a Phosphor chip-frame with the mask glyph: the incognito world, never an
 * avatar or a name. `aliasLabel` only when the blind thread context provides one.
 */
export function ExcerptBlock({ text, anon, aliasLabel, spans, className, clamp }: { text: string; anon: boolean; aliasLabel?: string | null; spans?: [number, number][]; className?: string; clamp?: boolean }) {
  const empty = !text.trim();
  if (anon) {
    return (
      <div data-surface="incognito" className={cn("rounded-lg border p-3", className)} style={{ background: P.surface1, borderColor: P.line, color: P.ink }}>
        <div className="flex items-start gap-2">
          <VenetianMask className="mt-0.5 h-4 w-4 shrink-0" style={{ color: P.accent }} aria-label="Anonymous" />
          <div className="min-w-0 flex-1">
            {aliasLabel ? (
              <div className="mb-0.5 text-xs" style={{ color: P.ink3 }}>
                {aliasLabel}
              </div>
            ) : null}
            <p className={cn("whitespace-pre-wrap break-words text-sm leading-relaxed", clamp && "line-clamp-4")}>
              {empty ? <span style={{ color: P.ink3 }}>(no text)</span> : <HighlightedText text={text} spans={spans} markStyle={{ background: P.accentSoft, color: P.accentInk }} />}
            </p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <blockquote className={cn("whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-900 ring-1 ring-inset ring-gray-200", clamp && "line-clamp-4", className)}>
      {empty ? <span className="text-gray-500">(no text)</span> : <HighlightedText text={text} spans={spans} markClassName="bg-amber-100 text-gray-900" />}
    </blockquote>
  );
}

export function BlindNote() {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" aria-hidden />
      <span>Anonymous surface. You are acting on the author of this item; the server resolves the account and never shows it here.</span>
    </div>
  );
}
