"use client";

import { useDocumentMetadata } from "@/stores/document-metadata";

// Minimal semantic metadata editor (Phase 3 TODO #1). No fonts/colors/layout
// in the DATA — this file's own JSX styling is presentation-only (T-06
// Slice 4) and does not change what's stored.
// Authors: one per line — `Name` or `Name / NameEn | aff-1,aff-2`
// Affiliations: one per line — `id | Institution` or `id | 中文 / English`
// Keywords: comma-separated

const LABEL_CLASS =
  "flex flex-col gap-[6px] text-[10px] tracking-[.1em] text-[var(--color-neutral-500)] uppercase";
const CONTROL_CLASS =
  "rounded-[var(--radius-md)] border border-[var(--color-neutral-300)] bg-[var(--color-bg)] px-[11px] py-[9px] text-[13.5px] normal-case tracking-normal text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2";

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
    <section className="flex flex-col gap-[16px] p-[16px]">
      <h3 className="m-0 text-[10px] tracking-[.14em] text-[var(--color-neutral-500)] uppercase">
        文档元数据
      </h3>
      <label className={LABEL_CLASS}>
        中文标题
        <input
          value={title}
          onChange={(e) => setField("title", e.target.value)}
          className={CONTROL_CLASS}
          placeholder="论文标题"
        />
      </label>
      <label className={LABEL_CLASS}>
        英文标题
        <input
          value={titleEn}
          onChange={(e) => setField("titleEn", e.target.value)}
          className={CONTROL_CLASS}
          placeholder="English title"
        />
      </label>
      <label className={LABEL_CLASS}>
        中文摘要
        <textarea
          value={abstract}
          onChange={(e) => setField("abstract", e.target.value)}
          rows={3}
          className={CONTROL_CLASS}
          placeholder="摘要（纯文本）"
        />
      </label>
      <label className={LABEL_CLASS}>
        英文摘要
        <textarea
          value={abstractEn}
          onChange={(e) => setField("abstractEn", e.target.value)}
          rows={3}
          className={CONTROL_CLASS}
          placeholder="English abstract"
        />
      </label>
      <label className={LABEL_CLASS}>
        中文关键词（逗号分隔）
        <input
          value={keywordsText}
          onChange={(e) => setField("keywordsText", e.target.value)}
          className={CONTROL_CLASS}
          placeholder="学术出版, 结构化编辑"
        />
      </label>
      <label className={LABEL_CLASS}>
        英文关键词（逗号分隔）
        <input
          value={keywordsEnText}
          onChange={(e) => setField("keywordsEnText", e.target.value)}
          className={CONTROL_CLASS}
          placeholder="AST, Typst, academic publishing"
        />
      </label>
      <label className={LABEL_CLASS}>
        作者（每行：Name 或 Name / NameEn | aff-1,aff-2）
        <textarea
          value={authorsText}
          onChange={(e) => setField("authorsText", e.target.value)}
          rows={3}
          className={`${CONTROL_CLASS} font-mono`}
          placeholder={"Ada Lovelace | aff-1\n王伟 / WANG Wei | aff-1,aff-2"}
        />
      </label>
      <label className={LABEL_CLASS}>
        单位（每行：id | name 或 id | 中文 / English）
        <textarea
          value={affiliationsText}
          onChange={(e) => setField("affiliationsText", e.target.value)}
          rows={3}
          className={`${CONTROL_CLASS} font-mono`}
          placeholder={"aff-1 | Analytical Engines Lab\naff-2 | 计算机学院 / School of CS"}
        />
      </label>
    </section>
  );
}
