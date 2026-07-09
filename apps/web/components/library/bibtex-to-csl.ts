import { parse, type ParsedCreator } from "@retorquere/bibtex-parser";
import { CslItemSchema, type CslItem } from "@depress/ast";

// 薄映射层:隔离 @retorquere/bibtex-parser 的输出形状,出口一律过
// CslItemSchema。BibTeX entry key 原样保留为 CSL id(canonical citeKey)。

const TYPE_MAP: Record<string, CslItem["type"]> = {
  article: "article-journal",
  book: "book",
  inproceedings: "paper-conference",
  conference: "paper-conference",
  incollection: "chapter",
  inbook: "chapter",
  phdthesis: "thesis",
  mastersthesis: "thesis",
  online: "webpage",
};

function toAuthor(creator: ParsedCreator): unknown {
  if (creator.firstName && creator.lastName) {
    return { family: creator.lastName, given: creator.firstName };
  }
  // 不拆分的姓名(中文作者、机构名)→ literal
  const literal = creator.lastName ?? creator.name;
  return { literal };
}

// @retorquere/bibtex-parser may return string | string[] for scalar fields
// (e.g. publisher). Coerce to a single trimmed string for CslItemSchema.
function fieldString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const parts = value
      .filter((part): part is string => typeof part === "string")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length === 0) return undefined;
    return parts.join(" ");
  }
  return undefined;
}

export function bibtexToCsl(text: string): { items: CslItem[]; errors: string[] } {
  let parsed: ReturnType<typeof parse>;
  try {
    // sentenceCase: false — 保留 BibTeX 原始大小写,不做句首小写化
    parsed = parse(text, { sentenceCase: false });
  } catch (error) {
    return { items: [], errors: [error instanceof Error ? error.message : String(error)] };
  }

  const items: CslItem[] = [];
  const errors: string[] = parsed.errors.map((e) => e.error);

  for (const entry of parsed.entries) {
    const fields = entry.fields as Record<string, unknown>;
    const yearRaw = fieldString(fields.year);
    const year = yearRaw !== undefined ? Number(yearRaw) : Number.NaN;
    const authors = (fields.author as ParsedCreator[] | undefined)?.map(toAuthor);
    const containerTitle =
      fieldString(fields.journal) ?? fieldString(fields.booktitle);
    const title = fieldString(fields.title);
    const doi = fieldString(fields.doi);
    const volume = fieldString(fields.volume);
    const issue = fieldString(fields.number);
    const page = fieldString(fields.pages);
    const publisher = fieldString(fields.publisher);
    const url = fieldString(fields.url);

    const candidate = {
      id: entry.key,
      type: TYPE_MAP[entry.type] ?? "document",
      title,
      ...(authors && authors.length > 0 ? { author: authors } : {}),
      ...(Number.isInteger(year) ? { issued: { "date-parts": [[year]] } } : {}),
      ...(containerTitle ? { "container-title": containerTitle } : {}),
      ...(doi ? { DOI: doi } : {}),
      ...(volume ? { volume } : {}),
      ...(issue ? { issue } : {}),
      ...(page ? { page } : {}),
      ...(publisher ? { publisher } : {}),
      ...(url ? { URL: url } : {}),
    };

    const result = CslItemSchema.safeParse(candidate);
    if (result.success) {
      items.push(result.data);
    } else {
      errors.push(`条目 ${entry.key || "(无 key)"} 校验失败: ${result.error.message}`);
    }
  }

  return { items, errors };
}
