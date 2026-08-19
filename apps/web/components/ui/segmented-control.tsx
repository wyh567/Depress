// Broadsheet segmented-control primitive (T-06 Slice 1). Standalone and
// unused — see button.tsx header comment for the wiring rule shared
// across ui/*.
//
// `.seg` + `.seg-opt` from the design system: a compact option group for
// things like the publication-template selector or the GB/T 7714 / IEEE
// citation-style toggle. This is a presentational replacement candidate
// for the existing `<select aria-label="PDF template">` in
// `compile-controls.tsx` — NOT wired in this slice. When a later slice
// adopts it there, the container must carry the same `aria-label` the
// test suite already asserts (`getByLabelText("PDF template")`), passed
// straight through via `groupProps`.
"use client";

import type { HTMLAttributes } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  groupProps?: Omit<HTMLAttributes<HTMLDivElement>, "className">;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  groupProps,
  className,
}: SegmentedControlProps<T>) {
  const containerClasses = [
    "inline-flex rounded-[var(--radius-md)] border border-[var(--color-divider)] " +
      "bg-[var(--color-neutral-100)] p-[2px]",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div role="group" className={containerClasses} {...groupProps}>
      {options.map((option) => {
        const selected = option.value === value;
        const optionClasses = [
          "rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-1)]",
          "text-[length:var(--text-interface-label)] font-[var(--font-body)] transition-colors",
          "focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]",
          "focus-visible:outline-offset-2",
          selected
            ? "bg-[var(--color-bg)] text-[var(--color-text)] shadow-[var(--shadow-sm)]"
            : "text-[var(--color-neutral-600)] hover:text-[var(--color-text)]",
        ].join(" ");
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            title={option.description}
            className={optionClasses}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
