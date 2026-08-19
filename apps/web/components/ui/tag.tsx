// Broadsheet tag primitive (T-06 Slice 1). Standalone and unused — see
// button.tsx header comment for the wiring rule shared across ui/*.
//
// Small labels tinted from the ramps: `accent` / `accent-2` / `neutral`
// fills, or an `outline` variant. Never both accents in one small
// component (design-system rule) — that discipline belongs to call
// sites, this primitive just exposes the four variants.
import type { HTMLAttributes, ReactNode } from "react";

export type TagVariant = "accent" | "accent-2" | "neutral" | "outline";

export interface TagProps extends Omit<HTMLAttributes<HTMLSpanElement>, "className"> {
  variant?: TagVariant;
  children: ReactNode;
  className?: string;
}

const BASE =
  "inline-flex items-center rounded-[var(--radius-sm)] px-[var(--space-2)] py-[2px] " +
  "text-[length:var(--text-overline)] font-[var(--font-body)] uppercase tracking-[.12em]";

const VARIANTS: Record<TagVariant, string> = {
  accent: "bg-[var(--color-accent-100)] text-[var(--color-accent-700)]",
  "accent-2": "bg-[var(--color-accent-2-100)] text-[var(--color-accent-2-700)]",
  neutral: "bg-[var(--color-neutral-200)] text-[var(--color-neutral-700)]",
  outline: "border border-[var(--color-divider)] text-[var(--color-neutral-700)]",
};

export function Tag({ variant = "neutral", children, className, ...rest }: TagProps) {
  const classes = [BASE, VARIANTS[variant], className].filter(Boolean).join(" ");
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
