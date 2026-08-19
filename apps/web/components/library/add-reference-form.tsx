"use client";

import { CslItemTypeSchema } from "@depress/ast";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useReferenceLibrary } from "@/stores/reference-library";

const TYPE_LABELS: Record<string, string> = {
  "article-journal": "Journal article",
  book: "Book",
  "paper-conference": "Conference paper",
  chapter: "Chapter",
  thesis: "Thesis",
  webpage: "Web page",
  document: "Other document",
};

// Broadsheet visual pass (T-06 Slice 6A). Presentation only — every prop,
// aria-label, field, validation rule, and store call below is unchanged
// from the pre-Slice-6A version: same citeKey/type/title/author/year
// fields, same submit/duplicate/error handling, same
// mutation !== "idle" disabled semantics.
const LABEL_CLASS =
  "flex flex-col gap-[4px] text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase";
// No `outline-none` here at all — verified live (via CSSOM/computed-style
// inspection) that applying it in ANY form (bare or `focus:`-conditioned)
// permanently pins Tailwind v4's shared `--tw-outline-style` custom
// property to "none", and `outline-2`/`focus-visible:outline-2` only ever
// sets `outline-width` — it reads `outline-style` from that same
// property rather than resetting it, so the ring never renders once
// `outline-none` has touched the element, conditioned or not. Tailwind's
// own default for `--tw-outline-style` is already "solid", and
// `outline-width` has no visible value until `focus-visible:outline-2`
// sets it, so no reset class is needed at all: at rest there is
// legitimately no width to show, and on focus-visible the ring renders
// correctly.
const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-[color:var(--color-accent)] focus-visible:outline-offset-2";
const CONTROL_CLASS =
  `w-full rounded-[var(--radius-md)] border border-[var(--color-neutral-300)] bg-[var(--color-bg)] px-[9px] py-[7px] text-[13px] normal-case tracking-normal text-[var(--color-text)] transition-colors ${FOCUS_RING}`;

// T-06 Slice 9A: `accessibleLabelPrefix` exists solely to disambiguate this
// form's accessible names when two instances are simultaneously mounted —
// the Editor's always-mounted copy (inside LibraryPanel, CSS-hidden
// whenever another top-level view is active, never unmounted so its draft
// survives) and the dedicated References view's own copy. Default
// `undefined` leaves every aria-label exactly as it was before this slice
// (the Editor instance, and every existing test asserting these labels).
// When provided, it is prepended directly into the aria-label string —
// not into any visible text — so the rendered UI is pixel-identical
// either way.
export function AddReferenceForm({
  accessibleLabelPrefix,
}: { accessibleLabelPrefix?: string } = {}) {
  const label = (text: string) =>
    accessibleLabelPrefix ? `${accessibleLabelPrefix} ${text}` : text;

  const createReference = useReferenceLibrary((state) => state.create);
  const mutation = useReferenceLibrary((state) => state.mutation);
  const [id, setId] = useState("");
  const [type, setType] = useState("article-journal");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const parsedYear = Number(year);
    try {
      if (year.trim() && !Number.isInteger(parsedYear)) {
        throw new Error("Invalid reference year");
      }
      const result = await createReference({
        id: id.trim(),
        type,
        title: title.trim(),
        ...(author.trim() ? { author: [{ literal: author.trim() }] } : {}),
        ...(year.trim() && Number.isInteger(parsedYear)
          ? { issued: { "date-parts": [[parsedYear]] } }
          : {}),
      });
      if (result.outcome !== "added") {
        setError(
          result.outcome === "duplicate_id"
            ? "A reference with this citeKey already exists."
            : "Reference could not be saved.",
        );
        return;
      }
      setId("");
      setTitle("");
      setAuthor("");
      setYear("");
      setError(null);
    } catch {
      setError("citeKey, type, title, author, or year is invalid.");
    }
  };

  return (
    <div className="flex flex-col gap-[8px] border-b border-[var(--color-divider)] p-[12px]">
      <p className="m-0 text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
        Add reference manually
      </p>
      <label className={LABEL_CLASS}>
        citeKey
        <input
          aria-label={label("citeKey")}
          value={id}
          onChange={(event) => setId(event.target.value)}
          className={CONTROL_CLASS}
        />
      </label>
      <label className={LABEL_CLASS}>
        Type
        <select
          aria-label={label("Reference type")}
          value={type}
          onChange={(event) => setType(event.target.value)}
          className={CONTROL_CLASS}
        >
          {CslItemTypeSchema.options.map((candidate) => (
            <option key={candidate} value={candidate}>
              {TYPE_LABELS[candidate]}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL_CLASS}>
        Title
        <input
          aria-label={label("Reference title")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={CONTROL_CLASS}
        />
      </label>
      <label className={LABEL_CLASS}>
        Author
        <input
          aria-label={label("Reference author")}
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
          className={CONTROL_CLASS}
        />
      </label>
      <label className={LABEL_CLASS}>
        Year
        <input
          aria-label={label("Reference year")}
          value={year}
          onChange={(event) => setYear(event.target.value)}
          className={CONTROL_CLASS}
        />
      </label>
      {error && (
        <p role="alert" className="m-0 text-[12px] text-[var(--color-accent-2-700)]">
          {error}
        </p>
      )}
      <Button
        variant="primary"
        onClick={() => void submit()}
        disabled={mutation !== "idle"}
        className="w-full"
        {...(accessibleLabelPrefix ? { "aria-label": label("Add reference") } : {})}
      >
        Add reference
      </Button>
    </div>
  );
}
