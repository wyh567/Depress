import type { CslAuthor, CslItem, CslItemType } from "@depress/ast";

const HAYAGRIVA_TYPE: Record<CslItemType, string> = {
  "article-journal": "Article",
  book: "Book",
  "paper-conference": "Article",
  chapter: "Chapter",
  thesis: "Thesis",
  webpage: "Web",
  document: "Misc",
};

const REQUIRED_PARENT_TYPE: Partial<Record<CslItemType, string>> = {
  "article-journal": "Periodical",
  "paper-conference": "Proceedings",
  chapter: "Book",
};

const CONTAINER_PARENT_TYPE: Record<CslItemType, string> = {
  "article-journal": "Periodical",
  book: "Anthology",
  "paper-conference": "Proceedings",
  chapter: "Book",
  thesis: "Repository",
  webpage: "Web",
  document: "Misc",
};

// JSON double-quoted strings are valid YAML 1.2 scalars. This gives one small,
// deterministic escaping surface for keys and values while preserving Unicode.
function yamlString(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function appendAuthors(lines: string[], authors: readonly CslAuthor[]): void {
  if (authors.length === 0) return;
  lines.push("  author:");
  for (const author of authors) {
    const name = author.literal ?? author.family;
    if (name === undefined) continue;
    lines.push(`    - name: ${yamlString(name)}`);
    if (author.literal === undefined && author.given !== undefined) {
      lines.push(`      given-name: ${yamlString(author.given)}`);
    }
  }
}

function appendScalar(
  lines: string[],
  indent: string,
  field: string,
  value: string | undefined,
): void {
  if (value !== undefined) lines.push(`${indent}${field}: ${yamlString(value)}`);
}

function appendParent(lines: string[], item: CslItem): void {
  const requiredType = REQUIRED_PARENT_TYPE[item.type];
  const hasContainer = item["container-title"] !== undefined;
  if (requiredType === undefined && !hasContainer) return;

  lines.push("  parent:");
  lines.push(
    `    type: ${requiredType ?? CONTAINER_PARENT_TYPE[item.type]}`,
  );
  appendScalar(lines, "    ", "title", item["container-title"]);

  if (requiredType !== undefined) {
    appendScalar(lines, "    ", "publisher", item.publisher);
    appendScalar(lines, "    ", "volume", item.volume);
    appendScalar(lines, "    ", "issue", item.issue);
  }
}

function appendItem(lines: string[], item: CslItem): void {
  lines.push(`${yamlString(item.id)}:`);
  lines.push(`  type: ${HAYAGRIVA_TYPE[item.type]}`);
  lines.push(`  title: ${yamlString(item.title)}`);
  appendAuthors(lines, item.author ?? []);

  const year = item.issued?.["date-parts"][0]?.[0];
  if (year !== undefined) lines.push(`  date: ${year}`);
  appendScalar(lines, "  ", "page-range", item.page);
  if (item.DOI !== undefined) {
    lines.push("  serial-number:");
    lines.push(`    doi: ${yamlString(item.DOI)}`);
  }
  appendScalar(lines, "  ", "url", item.URL);

  if (REQUIRED_PARENT_TYPE[item.type] === undefined) {
    appendScalar(lines, "  ", "publisher", item.publisher);
    appendScalar(lines, "  ", "volume", item.volume);
    appendScalar(lines, "  ", "issue", item.issue);
  }
  appendParent(lines, item);
}

// Pure CSL subset -> Hayagriva serializer. Input order is output order; the
// project renderer supplies the cited subset in first-occurrence order.
export function cslItemsToHayagriva(items: readonly CslItem[]): string {
  const lines: string[] = [];
  for (const item of items) appendItem(lines, item);
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
