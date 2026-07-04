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
    const year = Number(fields.year);
    const authors = (fields.author as ParsedCreator[] | undefined)?.map(toAuthor);
    const containerTitle = (fields.journal ?? fields.booktitle) as string | undefined;

    const candidate = {
      id: entry.key,
      type: TYPE_MAP[entry.type] ?? "document",
      title: fields.title,
      ...(authors && authors.length > 0 ? { author: authors } : {}),
      ...(Number.isInteger(year) ? { issued: { "date-parts": [[year]] } } : {}),
      ...(containerTitle ? { "container-title": containerTitle } : {}),
      ...(fields.doi ? { DOI: fields.doi } : {}),
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
