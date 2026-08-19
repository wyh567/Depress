// Broadsheet Papers Dashboard left rail (T-06 Slice 5). Deliberately
// minimal: the design shows filter counts (Recent/Drafts/Compiled/
// Archived, per-template counts) that have no data source in the current
// application — DocumentSummary is only {id, title, revision, updatedAt}.
// Per owner instruction, no fake counts, no fake filtering. This is a
// static navigation label, not a working filter — a later, separately
// approved slice can add a real "All Papers" vs. other real distinctions
// if/when the data exists to back them.
export function PaperDashboardRail() {
  return (
    <div className="flex flex-col gap-[6px] p-[16px]">
      <h2 className="text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
        Papers
      </h2>
      <span className="rounded-[var(--radius-md)] bg-[var(--color-accent-100)] px-[10px] py-[6px] text-[13px] font-medium text-[var(--color-accent-700)]">
        All Papers
      </span>
    </div>
  );
}
