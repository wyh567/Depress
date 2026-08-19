// Broadsheet field primitive (T-06 Slice 1). Standalone and unused — see
// button.tsx header comment for the wiring rule shared across ui/*.
//
// `.field` + `label` + `.input` from the design system, on native form
// elements — no script-driven behavior lives here. `Field` is a label
// wrapper; `Input` and `Textarea` are the styled native controls. Existing
// forms (add-reference-form.tsx, document-metadata-panel.tsx, etc.) keep
// their own aria-labels and test-asserted markup — this primitive is for
// later, separately-approved slices to adopt, not a replacement shipped
// today.
import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

const CONTROL_BASE =
  "w-full rounded-[var(--radius-md)] border border-[var(--color-neutral-300)] " +
  "bg-[var(--color-bg)] px-[var(--space-2)] py-[6px] text-[length:var(--text-interface-label)] " +
  "text-[var(--color-text)] font-[var(--font-body)] transition-colors " +
  "placeholder:text-[var(--color-neutral-500)] " +
  "focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] " +
  "focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45";

export interface FieldProps extends Omit<LabelHTMLAttributes<HTMLLabelElement>, "className"> {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({ label, children, className, ...rest }: FieldProps) {
  const classes = [
    "flex flex-col gap-[var(--space-1)] text-[length:var(--text-overline)] " +
      "uppercase tracking-[.1em] text-[var(--color-neutral-600)]",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <label className={classes} {...rest}>
      {label}
      {children}
    </label>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  className?: string;
}

export function Input({ className, ...rest }: InputProps) {
  const classes = [CONTROL_BASE, className].filter(Boolean).join(" ");
  return <input className={classes} {...rest} />;
}

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  className?: string;
}

export function Textarea({ className, ...rest }: TextareaProps) {
  const classes = [CONTROL_BASE, className].filter(Boolean).join(" ");
  return <textarea className={classes} {...rest} />;
}
