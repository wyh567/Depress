import { CslItemSchema, normalizeDoi, type CslItem } from "@depress/ast";
import { create } from "zustand";
import { bibtexToCsl } from "../components/library/bibtex-to-csl";
import {
  ReferenceConflictError,
  referenceClient,
  type ReferenceApiClient,
} from "../lib/reference-client";

export type ReferenceMutationState =
  | "idle"
  | "creating"
  | "updating"
  | "deleting";

export type TryAddResult =
  | { outcome: "added"; item: CslItem }
  | { outcome: "duplicate_id" }
  | { outcome: "duplicate_doi" }
  | { outcome: "failed" };

export interface ReferenceSessionContext {
  userId: string;
  generation: number;
}

export interface ReferenceLibraryState {
  items: CslItem[];
  loading: boolean;
  mutation: ReferenceMutationState;
  error: string | null;
  lastConfirmedItems: CslItem[];
  activeUserId: string | null;
  captureSession: () => ReferenceSessionContext | undefined;
  load: (userId: string, client?: ReferenceApiClient) => Promise<boolean>;
  create: (
    candidate: unknown,
    client?: ReferenceApiClient,
    expectedContext?: ReferenceSessionContext,
  ) => Promise<TryAddResult>;
  tryAdd: (
    candidate: unknown,
    client?: ReferenceApiClient,
    expectedContext?: ReferenceSessionContext,
  ) => Promise<TryAddResult>;
  update: (
    referenceIdentity: string,
    candidate: unknown,
    client?: ReferenceApiClient,
    expectedContext?: ReferenceSessionContext,
  ) => Promise<boolean>;
  remove: (
    id: string,
    client?: ReferenceApiClient,
    expectedContext?: ReferenceSessionContext,
  ) => Promise<boolean>;
  has: (id: string) => boolean;
  hasDoi: (doi: string) => boolean;
  importBibtex: (
    text: string,
    client?: ReferenceApiClient,
  ) => Promise<{ imported: number; errors: string[] }>;
  clear: () => void;
}

const SAFE_ERROR = "Reference change failed. Confirmed references were not changed.";
let sessionGeneration = 0;

function sorted(items: CslItem[]): CslItem[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function normalizedItemDoi(item: CslItem): string | undefined {
  if (item.DOI) {
    const fromField = normalizeDoi(item.DOI);
    if (fromField.ok) return fromField.doi;
  }
  const fromId = normalizeDoi(item.id);
  return fromId.ok ? fromId.doi : undefined;
}

function confirmed(items: CslItem[]) {
  const next = sorted(items);
  return {
    items: next,
    lastConfirmedItems: next,
    error: null,
  };
}

function isCurrentSession(
  context: ReferenceSessionContext,
  state: Pick<ReferenceLibraryState, "activeUserId">,
): boolean {
  return (
    context.generation === sessionGeneration &&
    context.userId === state.activeUserId
  );
}

export const useReferenceLibrary = create<ReferenceLibraryState>()((set, get) => ({
  items: [],
  loading: false,
  mutation: "idle",
  error: null,
  lastConfirmedItems: [],
  activeUserId: null,

  captureSession: () => {
    const userId = get().activeUserId;
    return userId === null
      ? undefined
      : { userId, generation: sessionGeneration };
  },

  load: async (userId, client = referenceClient) => {
    if (userId.length === 0) return false;
    const switchingUser = get().activeUserId !== userId;
    const context = { userId, generation: ++sessionGeneration };
    set({
      ...(switchingUser ? { items: [], lastConfirmedItems: [] } : {}),
      activeUserId: userId,
      loading: true,
      mutation: "idle",
      error: null,
    });
    try {
      const items = await client.listReferences();
      if (!isCurrentSession(context, get())) return false;
      set({ ...confirmed(items), loading: false });
      return true;
    } catch {
      if (!isCurrentSession(context, get())) return false;
      set({ loading: false, error: SAFE_ERROR });
      return false;
    }
  },

  create: async (candidate, client = referenceClient, expectedContext) => {
    const item = CslItemSchema.parse(candidate);
    const context = expectedContext ?? get().captureSession();
    if (!context || !isCurrentSession(context, get())) {
      return { outcome: "failed" };
    }
    set({ mutation: "creating", error: null });
    try {
      const created = await client.createReference(item);
      if (!isCurrentSession(context, get())) return { outcome: "failed" };
      set({
        ...confirmed([
          ...get().lastConfirmedItems.filter((existing) => existing.id !== created.id),
          created,
        ]),
        mutation: "idle",
      });
      return { outcome: "added", item: created };
    } catch (error) {
      if (!isCurrentSession(context, get())) return { outcome: "failed" };
      set({
        mutation: "idle",
        error:
          error instanceof ReferenceConflictError
            ? "A reference with this citeKey already exists."
            : SAFE_ERROR,
      });
      return error instanceof ReferenceConflictError
        ? { outcome: "duplicate_id" }
        : { outcome: "failed" };
    }
  },

  tryAdd: async (candidate, client = referenceClient, expectedContext) => {
    const item = CslItemSchema.parse(candidate);
    const context = expectedContext ?? get().captureSession();
    if (!context || !isCurrentSession(context, get())) {
      return { outcome: "failed" };
    }
    if (get().has(item.id)) return { outcome: "duplicate_id" };
    const incomingDoi = normalizedItemDoi(item);
    if (
      incomingDoi &&
      get().items.some((existing) => normalizedItemDoi(existing) === incomingDoi)
    ) {
      return { outcome: "duplicate_doi" };
    }
    return get().create(item, client, context);
  },

  update: async (
    referenceIdentity,
    candidate,
    client = referenceClient,
    expectedContext,
  ) => {
    const item = CslItemSchema.parse(candidate);
    const context = expectedContext ?? get().captureSession();
    if (!context || !isCurrentSession(context, get())) return false;
    set({ mutation: "updating", error: null });
    try {
      const updated = await client.updateReference(referenceIdentity, item);
      if (!isCurrentSession(context, get())) return false;
      set({
        ...confirmed([
          ...get().lastConfirmedItems.filter(
            (existing) => existing.id !== referenceIdentity,
          ),
          updated,
        ]),
        mutation: "idle",
      });
      return true;
    } catch {
      if (!isCurrentSession(context, get())) return false;
      set({ mutation: "idle", error: SAFE_ERROR });
      return false;
    }
  },

  remove: async (id, client = referenceClient, expectedContext) => {
    const context = expectedContext ?? get().captureSession();
    if (!context || !isCurrentSession(context, get())) return false;
    set({ mutation: "deleting", error: null });
    try {
      await client.deleteReference(id);
      if (!isCurrentSession(context, get())) return false;
      set({
        ...confirmed(
          get().lastConfirmedItems.filter((existing) => existing.id !== id),
        ),
        mutation: "idle",
      });
      return true;
    } catch {
      if (!isCurrentSession(context, get())) return false;
      set({ mutation: "idle", error: SAFE_ERROR });
      return false;
    }
  },

  has: (id) => get().items.some((item) => item.id === id),

  hasDoi: (doi) => {
    const normalized = normalizeDoi(doi);
    if (!normalized.ok) return false;
    return get().items.some(
      (item) => normalizedItemDoi(item) === normalized.doi,
    );
  },

  importBibtex: async (text, client = referenceClient) => {
    const parsed = bibtexToCsl(text);
    const context = get().captureSession();
    let imported = 0;
    const errors = [...parsed.errors];
    for (const item of parsed.items) {
      const result = await get().create(item, client, context);
      if (result.outcome === "added") imported += 1;
      else if (result.outcome === "duplicate_id") {
        errors.push(`Reference ${item.id}: duplicate citeKey.`);
      } else {
        errors.push(`Reference ${item.id}: save failed.`);
      }
    }
    return { imported, errors };
  },

  clear: () => {
    sessionGeneration += 1;
    set({
      items: [],
      loading: false,
      mutation: "idle",
      error: null,
      lastConfirmedItems: [],
      activeUserId: null,
    });
  },
}));
