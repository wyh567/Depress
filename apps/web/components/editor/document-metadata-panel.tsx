"use client";

import { useDocumentMetadata } from "@/stores/document-metadata";

// Minimal semantic metadata editor (Phase 3 TODO #1). No fonts/colors/layout.
// Authors: one per line — `Name` or `Name / NameEn | aff-1,aff-2`
// Affiliations: one per line — `id | Institution` or `id | 中文 / English`
// Keywords: comma-separated

export function DocumentMetadataPanel() {
  const title = useDocumentMetadata((s) => s.title);
  const titleEn = useDocumentMetadata((s) => s.titleEn);
  const abstract = useDocumentMetadata((s) => s.abstract);
  const abstractEn = useDocumentMetadata((s) => s.abstractEn);
  const keywordsText = useDocumentMetadata((s) => s.keywordsText);
  const keywordsEnText = useDocumentMetadata((s) => s.keywordsEnText);
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
          中文标题
          <input
            value={title}
            onChange={(e) => setField("title", e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800"
            placeholder="论文标题"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600 sm:col-span-2">
          英文标题
          <input
            value={titleEn}
            onChange={(e) => setField("titleEn", e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800"
            placeholder="English title"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600 sm:col-span-2">
          中文摘要
          <textarea
            value={abstract}
            onChange={(e) => setField("abstract", e.target.value)}
            rows={2}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800"
            placeholder="摘要（纯文本）"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600 sm:col-span-2">
          英文摘要
          <textarea
            value={abstractEn}
            onChange={(e) => setField("abstractEn", e.target.value)}
            rows={2}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800"
            placeholder="English abstract"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600 sm:col-span-2">
          中文关键词（逗号分隔）
          <input
            value={keywordsText}
            onChange={(e) => setField("keywordsText", e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800"
            placeholder="学术出版, 结构化编辑"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600 sm:col-span-2">
          英文关键词（逗号分隔）
          <input
            value={keywordsEnText}
            onChange={(e) => setField("keywordsEnText", e.target.value)}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800"
            placeholder="AST, Typst, academic publishing"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          作者（每行：Name 或 Name / NameEn | aff-1,aff-2）
          <textarea
            value={authorsText}
            onChange={(e) => setField("authorsText", e.target.value)}
            rows={3}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-800"
            placeholder={"Ada Lovelace | aff-1\n王伟 / WANG Wei | aff-1,aff-2"}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          单位（每行：id | name 或 id | 中文 / English）
          <textarea
            value={affiliationsText}
            onChange={(e) => setField("affiliationsText", e.target.value)}
            rows={3}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-800"
            placeholder={
              "aff-1 | Analytical Engines Lab\naff-2 | 计算机学院 / School of CS"
            }
          />
        </label>
      </div>
    </section>
  );
}
