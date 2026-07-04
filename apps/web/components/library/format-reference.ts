import type { CslItem } from "@depress/ast";

export function formatAuthors(item: CslItem): string {
  if (!item.author || item.author.length === 0) return "佚名";
  const names = item.author.map((a) => a.literal ?? [a.family, a.given].filter(Boolean).join(", "));
  return names.length > 2 ? `${names[0]} 等` : names.join("; ");
}

export function formatYear(item: CslItem): string {
  const year = item.issued?.["date-parts"]?.[0]?.[0];
  return year !== undefined ? `(${year})` : "";
}
