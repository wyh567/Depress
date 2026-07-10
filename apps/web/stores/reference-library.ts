import { create } from "zustand";
import { CslItemSchema, normalizeDoi, type CslItem } from "@depress/ast";
import { bibtexToCsl } from "../components/library/bibtex-to-csl";

// 内存引用库(Phase 1)。持久化与后端在 Phase 4。
// 手动添加 / BibTeX 仍走 upsert(同 id 覆盖)。
// DOI 导入走 tryAdd：同 id 或同 DOI 绝不覆盖。

export type TryAddResult =
  | { outcome: "added"; item: CslItem }
  | { outcome: "duplicate_id" }
  | { outcome: "duplicate_doi" };

interface ReferenceLibraryState {
  items: CslItem[];
  upsert: (candidate: unknown) => CslItem;
  tryAdd: (candidate: unknown) => TryAddResult;
  remove: (id: string) => void;
  has: (id: string) => boolean;
  hasDoi: (doi: string) => boolean;
  importBibtex: (text: string) => { imported: number; errors: string[] };
  clear: () => void;
}

function normalizedItemDoi(item: CslItem): string | undefined {
  if (item.DOI) {
    const fromField = normalizeDoi(item.DOI);
    if (fromField.ok) return fromField.doi;
  }
  const fromId = normalizeDoi(item.id);
  return fromId.ok ? fromId.doi : undefined;
}

export const useReferenceLibrary = create<ReferenceLibraryState>()((set, get) => ({
  items: [],

  upsert: (candidate) => {
    const item = CslItemSchema.parse(candidate);
    set((state) => ({
      items: [...state.items.filter((existing) => existing.id !== item.id), item],
    }));
    return item;
  },

  tryAdd: (candidate) => {
    const item = CslItemSchema.parse(candidate);
    const state = get();
    if (state.items.some((existing) => existing.id === item.id)) {
      return { outcome: "duplicate_id" };
    }
    const incomingDoi = normalizedItemDoi(item);
    if (
      incomingDoi &&
      state.items.some((existing) => normalizedItemDoi(existing) === incomingDoi)
    ) {
      return { outcome: "duplicate_doi" };
    }
    set({ items: [...state.items, item] });
    return { outcome: "added", item };
  },

  remove: (id) => {
    set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
  },

  has: (id) => get().items.some((item) => item.id === id),

  hasDoi: (doi) => {
    const normalized = normalizeDoi(doi);
    if (!normalized.ok) return false;
    return get().items.some(
      (item) => normalizedItemDoi(item) === normalized.doi,
    );
  },

  importBibtex: (text) => {
    const { items, errors } = bibtexToCsl(text);
    for (const item of items) get().upsert(item);
    return { imported: items.length, errors };
  },

  clear: () => set({ items: [] }),
}));
