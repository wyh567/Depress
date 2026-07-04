"use client";

import { useState } from "react";
import { CslItemTypeSchema } from "@depress/ast";
import { useReferenceLibrary } from "@/stores/reference-library";

const TYPE_LABELS: Record<string, string> = {
  "article-journal": "期刊论文",
  book: "专著",
  "paper-conference": "会议论文",
  chapter: "章节",
  thesis: "学位论文",
  webpage: "网页",
  document: "其他文档",
};

export function AddReferenceForm() {
  const upsert = useReferenceLibrary((state) => state.upsert);
  const [id, setId] = useState("");
  const [type, setType] = useState("article-journal");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const parsedYear = Number(year);
    try {
      upsert({
        id: id.trim(),
        type,
        title: title.trim(),
        ...(author.trim() ? { author: [{ literal: author.trim() }] } : {}),
        ...(year.trim() && Number.isInteger(parsedYear)
          ? { issued: { "date-parts": [[parsedYear]] } }
          : {}),
      });
      setId("");
      setTitle("");
      setAuthor("");
      setYear("");
      setError(null);
    } catch {
      setError("校验失败:citeKey 和标题必填,年份需为整数");
    }
  };

  const inputCls =
    "w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none";

  return (
    <div className="space-y-2 border-b border-gray-200 p-3">
      <p className="text-xs font-semibold text-gray-500">手动添加</p>
      <input value={id} onChange={(e) => setId(e.target.value)} placeholder="citeKey(必填)" className={inputCls} />
      <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
        {CslItemTypeSchema.options.map((t) => (
          <option key={t} value={t}>
            {TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题(必填)" className={inputCls} />
      <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="作者(可选)" className={inputCls} />
      <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="年份(可选)" className={inputCls} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        onClick={submit}
        className="w-full rounded bg-blue-600 py-1.5 text-sm text-white hover:bg-blue-700"
      >
        添加文献
      </button>
    </div>
  );
}
