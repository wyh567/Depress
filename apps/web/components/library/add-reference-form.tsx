"use client";

import { CslItemTypeSchema } from "@depress/ast";
import { useState } from "react";
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

export function AddReferenceForm() {
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

  const inputClass =
    "w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none";

  return (
    <div className="space-y-2 border-b border-gray-200 p-3">
      <p className="text-xs font-semibold text-gray-500">Add reference manually</p>
      <input aria-label="citeKey" value={id} onChange={(event) => setId(event.target.value)} className={inputClass} />
      <select aria-label="Reference type" value={type} onChange={(event) => setType(event.target.value)} className={inputClass}>
        {CslItemTypeSchema.options.map((candidate) => (
          <option key={candidate} value={candidate}>{TYPE_LABELS[candidate]}</option>
        ))}
      </select>
      <input aria-label="Reference title" value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} />
      <input aria-label="Reference author" value={author} onChange={(event) => setAuthor(event.target.value)} className={inputClass} />
      <input aria-label="Reference year" value={year} onChange={(event) => setYear(event.target.value)} className={inputClass} />
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <button type="button" onClick={() => void submit()} disabled={mutation !== "idle"} className="w-full rounded bg-blue-600 py-1.5 text-sm text-white">
        Add reference
      </button>
    </div>
  );
}
