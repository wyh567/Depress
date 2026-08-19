// Broadsheet button primitive (T-06 Slice 1).
//
// Standalone and unused: not imported by any live screen yet. Wiring this
// into `compile-controls.tsx`, `editor-area.tsx`, etc. is later-slice work
// and must preserve every existing accessible name/behavior on those
// call sites — this file only defines the visual primitive.
//
// Variants follow the design system: `.btn-primary` is a solid accent
// fill (one primary action per surface), `.btn-secondary` an outlined
// neutral, `.btn-ghost` text-only, `.btn-icon` a square icon-only button.
// Interaction states (hover/pressed/focus/disabled) come from the accent
// ramp and the shared focus ring, never browser defaults.
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "icon";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  children: ReactNode;
  className?: string;
}

const BASE =
  "inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] " +
  "font-[var(--font-body)] text-[length:var(--text-interface-label)] transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-45 " +
  "focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] " +
  "focus-visible:outline-offset-2";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-text)] text-[var(--color-bg)] px-[var(--space-4)] py-[var(--space-2)] " +
    "hover:bg-[var(--color-neutral-800)] active:bg-[var(--color-neutral-900)]",
  secondary:
    "border border-[var(--color-divider)] text-[var(--color-text)] px-[var(--space-4)] " +
    "py-[var(--space-2)] hover:bg-[var(--color-neutral-100)] active:bg-[var(--color-neutral-200)]",
  ghost:
    "text-[var(--color-neutral-700)] px-[var(--space-2)] py-[var(--space-1)] " +
    "hover:text-[var(--color-text)] hover:bg-[var(--color-neutral-100)]",
  icon: "text-[var(--color-neutral-700)] p-[var(--space-2)] rounded-[var(--radius-md)] " +
    "hover:text-[var(--color-text)] hover:bg-[var(--color-neutral-100)]",
};

export function Button({
  variant = "secondary",
  children,
  className,
  ...rest
}: ButtonProps) {
  const classes = [BASE, VARIANTS[variant], className].filter(Boolean).join(" ");
  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  );
}
