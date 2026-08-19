// Broadsheet References left rail (T-06 Slice 6). Deliberately minimal —
// same rationale as PaperDashboardRail: no fabricated section/reference
// counts. `activePaperTitle` is real data, passed down from
// DocumentWorkspace (which already owns `documents`/`activeDocumentId`),
// shown only when a document is actually open — never invented.
export function ReferencesRail({ activePaperTitle }: { activePaperTitle: string | undefined }) {
  return (
    <div className="flex flex-col gap-[6px] p-[16px]">
      <h2 className="text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
        References
      </h2>
      <span className="rounded-[var(--radius-md)] bg-[var(--color-accent-100)] px-[10px] py-[6px] text-[13px] font-medium text-[var(--color-accent-700)]">
        Reference Library
      </span>
      {activePaperTitle && (
        <div className="mt-[16px] flex flex-col gap-[2px]">
          <span className="text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase">
            Current paper
          </span>
          <span className="truncate text-[13px] text-[var(--color-neutral-700)]">
            {activePaperTitle}
          </span>
        </div>
      )}
    </div>
  );
}
