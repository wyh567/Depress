import { z } from "zod";

// 最小 CSL-JSON 子集(Phase 1)。id 即全项目的 canonical citeKey。
// 未知/未映射的来源类型一律用 CSL 标准类型 "document"。

// 所有字符串字段统一 trim 后非空,防止纯空白或带首尾空格的值入库
const trimmedNonEmpty = z.string().trim().min(1);

export const CslAuthorSchema = z
  .object({
    family: trimmedNonEmpty.optional(),
    given: trimmedNonEmpty.optional(),
    // 不拆分的姓名(如中文作者)
    literal: trimmedNonEmpty.optional(),
  })
  .refine((a) => a.family !== undefined || a.literal !== undefined, {
    message: "作者需要 family 或 literal 之一",
  });
export type CslAuthor = z.infer<typeof CslAuthorSchema>;

export const CslItemTypeSchema = z.enum([
  "article-journal",
  "book",
  "paper-conference",
  "chapter",
  "thesis",
  "webpage",
  "document",
]);
export type CslItemType = z.infer<typeof CslItemTypeSchema>;

// Phase 3 bibliography subset: enough for IEEE / Elsevier / GB/T journal
// articles, books, and webpages. Speculative CSL fields are intentionally
// omitted until a concrete template needs them.
export const CslItemSchema = z.object({
  id: trimmedNonEmpty,
  type: CslItemTypeSchema,
  title: trimmedNonEmpty,
  author: z.array(CslAuthorSchema).optional(),
  issued: z.object({ "date-parts": z.array(z.array(z.number().int())) }).optional(),
  "container-title": trimmedNonEmpty.optional(),
  DOI: trimmedNonEmpty.optional(),
  volume: trimmedNonEmpty.optional(),
  issue: trimmedNonEmpty.optional(),
  page: trimmedNonEmpty.optional(),
  publisher: trimmedNonEmpty.optional(),
  URL: trimmedNonEmpty.optional(),
});
export type CslItem = z.infer<typeof CslItemSchema>;
