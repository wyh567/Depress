"use client";

import { useDocumentMetadata } from "@/stores/document-metadata";

// Minimal semantic metadata editor (Phase 3 TODO #1). No fonts/colors/layout.
// Authors: one per line — `Name` or `Name | aff-1,aff-2`
// Affiliations: one per line — `id | Institution name`
// Keywords: comma-separated

export function DocumentMetadataPanel() {
  const title = useDocumentMetadata((s) => s.title);
  const abstract = useDocumentMetadata((s) => s.abstract);
  const keywordsText = useDocumentMetadata((s) => s.keywordsText);
  const authorsText = useDocumentMetadata((s) => s.authorsText);
  const affiliationsText = useDocumentMetadata((s) => s.affiliationsText);
  const setField = useDocumentMetadata((s) => s.setField);

  return (
    <section className="border-b border-gray-200 bg-gray-50 px-4 py-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        文档元数据
      </h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-gray-600 sm:col-span-2">
          标题
          <input
            value={title}
            onChange={(e) => setField("title", e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800"
            placeholder="论文标题"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600 sm:col-span-2">
          摘要
          <textarea
            value={abstract}
            onChange={(e) => setField("abstract", e.target.value)}
            rows={2}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800"
            placeholder="摘要（纯文本）"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600 sm:col-span-2">
          关键词（逗号分隔）
          <input
            value={keywordsText}
            onChange={(e) => setField("keywordsText", e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800"
            placeholder="AST, Typst, academic publishing"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          作者（每行：Name 或 Name | aff-1,aff-2）
          <textarea
            value={authorsText}
            onChange={(e) => setField("authorsText", e.target.value)}
            rows={3}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-800"
            placeholder={"Ada Lovelace | aff-1\n王伟 | aff-1,aff-2"}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          单位（每行：id | name）
          <textarea
            value={affiliationsText}
            onChange={(e) => setField("affiliationsText", e.target.value)}
            rows={3}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-800"
            placeholder={"aff-1 | Analytical Engines Lab\naff-2 | 计算机学院"}
          />
        </label>
      </div>
    </section>
  );
}
