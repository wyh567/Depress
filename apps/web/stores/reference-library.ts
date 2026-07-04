import { create } from "zustand";
import { CslItemSchema, type CslItem } from "@depress/ast";
import { bibtexToCsl } from "../components/library/bibtex-to-csl";

// 内存引用库(Phase 1)。持久化与后端在 Phase 4。
// 所有入口(手动添加 / BibTeX 导入)都过 CslItemSchema;重复 id 后写入覆盖。

interface ReferenceLibraryState {
  items: CslItem[];
  upsert: (candidate: unknown) => CslItem;
  remove: (id: string) => void;
  has: (id: string) => boolean;
  importBibtex: (text: string) => { imported: number; errors: string[] };
  clear: () => void;
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

  remove: (id) => {
    set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
  },

  has: (id) => get().items.some((item) => item.id === id),

  importBibtex: (text) => {
    const { items, errors } = bibtexToCsl(text);
    for (const item of items) get().upsert(item);
    return { imported: items.length, errors };
  },

  clear: () => set({ items: [] }),
}));
