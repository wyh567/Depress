// @vitest-environment jsdom
import {
  EmptyPersistedDocumentEnvelope,
  type DocumentResource,
  type PersistedDocumentEnvelope,
} from "@depress/ast";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentApiClient } from "@/lib/document-client";
import { DocumentConflictError } from "@/lib/document-client";
import { useDocumentMetadata } from "@/stores/document-metadata";
import { DocumentWorkspace } from "./document-workspace";

const editorHarness = vi.hoisted(() => {
  let json: unknown = { type: "doc", content: [{ type: "paragraph" }] };
  let onUpdate: (() => void) | undefined;
  const editor = {
    on: vi.fn((event: string, callback: () => void) => {
      if (event === "update") onUpdate = callback;
    }),
    off: vi.fn((event: string, callback: () => void) => {
      if (event === "update" && onUpdate === callback) onUpdate = undefined;
    }),
    getJSON: vi.fn(() => json),
    commands: {
      setContent: vi.fn((content: unknown) => {
        json = structuredClone(content);
      }),
    },
    chain: vi.fn(() => ({
      focus: () => ({
        insertCitation: () => ({ run: () => true }),
      }),
    })),
  };
  return {
    editor,
    edit(content: unknown) {
      json = structuredClone(content);
      onUpdate?.();
    },
    json() {
      return json;
    },
    reset() {
      json = { type: "doc", content: [{ type: "paragraph" }] };
      onUpdate = undefined;
      editor.on.mockClear();
      editor.off.mockClear();
      editor.getJSON.mockClear();
      editor.commands.setContent.mockClear();
    },
  };
});

vi.mock("./editor/use-depress-editor", () => ({
  useDepressEditor: () => editorHarness.editor,
}));

vi.mock("./library/library-panel", () => ({
  LibraryPanel: () => <aside>Reference library</aside>,
}));

vi.mock("./editor/editor-area", () => ({
  EditorArea: (props: {
    activeDocumentId?: string;
    activeRevision?: number;
    saveState: string;
    onSave: () => void;
    onReloadServer: () => void;
    onKeepEditing: () => void;
  }) => (
    <main>
      <span>state:{props.saveState}</span>
      {props.activeRevision !== undefined && <span>revision:{props.activeRevision}</span>}
      <button type="button" onClick={props.onSave} disabled={!props.activeDocumentId}>
        Save
      </button>
      <button
        type="button"
        onClick={() =>
          editorHarness.edit({
            type: "doc",
            content: [
              {
                type: "heading",
                attrs: { level: 2 },
                content: [
                  { type: "text", text: "Heading", marks: [{ type: "bold" }] },
                ],
              },
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Body", marks: [{ type: "italic" }] },
                  { type: "citation", attrs: { citeKey: "smith2024" } },
                ],
              },
            ],
          })
        }
      >
        Edit body
      </button>
      {props.saveState === "failed" && <div role="alert">Local changes retained</div>}
      {props.saveState === "conflict" && (
        <div role="alert">
          Server has a newer revision
          <button type="button" onClick={props.onReloadServer}>
            Reload Server Version
          </button>
          <button type="button" onClick={props.onKeepEditing}>
            Keep Editing
          </button>
        </div>
      )}
    </main>
  ),
}));

const ID_A = "39e35789-2e60-4d40-840a-ef10cf05fab7";
const ID_B = "e58dc609-e84d-4f0d-aa61-8c014edecf40";
const CREATED_AT = "2026-07-27T00:00:00.000Z";

const supportedEnvelope: PersistedDocumentEnvelope = {
  schemaVersion: 1,
  editor: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Heading", marks: [{ type: "bold" }] }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Body", marks: [{ type: "italic" }] },
          { type: "citation", attrs: { citeKey: "smith2024" } },
        ],
      },
    ],
  },
  metadata: {
    title: "Mentor article",
    authors: [{ name: "Mentor" }],
    abstract: "Saved abstract",
    keywords: ["MVP", "Typst"],
  },
};

function resource(
  id: string,
  revision: number,
  envelope: PersistedDocumentEnvelope = EmptyPersistedDocumentEnvelope,
): DocumentResource {
  return {
    id,
    revision,
    envelope,
    createdAt: CREATED_AT,
    updatedAt: `2026-07-27T00:00:0${revision}.000Z`,
  };
}

function clientWith(
  overrides: Partial<DocumentApiClient> = {},
): DocumentApiClient {
  return {
    listDocuments: vi.fn().mockResolvedValue([]),
    createDocument: vi.fn().mockResolvedValue(resource(ID_A, 1)),
    getDocument: vi.fn().mockResolvedValue(resource(ID_A, 1)),
    updateDocument: vi.fn().mockResolvedValue(resource(ID_A, 2, supportedEnvelope)),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("manual document save and reopen workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editorHarness.reset();
    useDocumentMetadata.getState().clear();
  });

  it("renders an empty list, creates a document, and hydrates without becoming dirty", async () => {
    const client = clientWith();
    render(<DocumentWorkspace client={client} />);

    expect(await screen.findByText("No documents yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New" }));

    await waitFor(() => expect(client.createDocument).toHaveBeenCalledTimes(1));
    expect(screen.getByText("state:saved")).toBeInTheDocument();
    expect(screen.getByText("revision:1")).toBeInTheDocument();
    expect(editorHarness.editor.commands.setContent).toHaveBeenCalledWith(
      EmptyPersistedDocumentEnvelope.editor,
      { emitUpdate: false, errorOnInvalidContent: true },
    );
  });

  it("saves supported body and metadata, advances revision, then reopens exactly", async () => {
    const saved = resource(ID_A, 2, supportedEnvelope);
    const client = clientWith({
      listDocuments: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: ID_A,
            title: "Mentor article",
            revision: 2,
            updatedAt: saved.updatedAt,
          },
        ]),
      updateDocument: vi.fn().mockResolvedValue(saved),
      getDocument: vi.fn().mockResolvedValue(saved),
    });
    const first = render(<DocumentWorkspace client={client} />);
    await screen.findByText("No documents yet.");
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    await screen.findByText("revision:1");

    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    act(() => {
      useDocumentMetadata.getState().hydrate(supportedEnvelope.metadata);
    });
    expect(screen.getByText("state:dirty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(client.updateDocument).toHaveBeenCalledWith(ID_A, 1, supportedEnvelope),
    );
    expect(await screen.findByText("revision:2")).toBeInTheDocument();
    expect(screen.getByText("state:saved")).toBeInTheDocument();
    first.unmount();

    render(<DocumentWorkspace client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Mentor article/ }));
    await waitFor(() => expect(client.getDocument).toHaveBeenCalledWith(ID_A));
    expect(editorHarness.editor.commands.setContent).toHaveBeenLastCalledWith(
      supportedEnvelope.editor,
      { emitUpdate: false, errorOnInvalidContent: true },
    );
    expect(useDocumentMetadata.getState().toMetadataCandidate()).toEqual(
      supportedEnvelope.metadata,
    );
    expect(screen.getByText("state:saved")).toBeInTheDocument();
  });

  it("preserves local edits after failed and conflicting saves", async () => {
    const updateDocument = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new DocumentConflictError(3));
    const client = clientWith({ updateDocument });
    render(<DocumentWorkspace client={client} />);
    await screen.findByText("No documents yet.");
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    await screen.findByText("revision:1");
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    const localBody = structuredClone(editorHarness.json());

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Local changes retained");
    expect(editorHarness.json()).toEqual(localBody);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("newer revision");
    expect(editorHarness.json()).toEqual(localBody);
    expect(screen.getByRole("button", { name: "Reload Server Version" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
    expect(screen.getByText("state:dirty")).toBeInTheDocument();
  });

  it("blocks cross-document switching when unsaved changes are not discarded", async () => {
    const confirmDiscard = vi.fn(() => false);
    const client = clientWith({
      listDocuments: vi.fn().mockResolvedValue([
        { id: ID_A, title: "First", revision: 1, updatedAt: CREATED_AT },
        { id: ID_B, title: "Second", revision: 1, updatedAt: CREATED_AT },
      ]),
      getDocument: vi
        .fn()
        .mockImplementation((id: string) => Promise.resolve(resource(id, 1))),
    });
    render(<DocumentWorkspace client={client} confirmDiscard={confirmDiscard} />);

    fireEvent.click(await screen.findByRole("button", { name: /^First/ }));
    await screen.findByText("revision:1");
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    fireEvent.click(screen.getByRole("button", { name: /^Second/ }));

    expect(confirmDiscard).toHaveBeenCalledTimes(1);
    expect(client.getDocument).toHaveBeenCalledTimes(1);
    expect(client.getDocument).toHaveBeenCalledWith(ID_A);
    expect(editorHarness.json()).toEqual(supportedEnvelope.editor);
  });

  it("keeps B active when open A resolves after the later open B request", async () => {
    const requestA = deferred<DocumentResource>();
    const requestB = deferred<DocumentResource>();
    const envelopeB: PersistedDocumentEnvelope = {
      ...supportedEnvelope,
      metadata: { title: "Second document" },
    };
    const client = clientWith({
      listDocuments: vi.fn().mockResolvedValue([
        { id: ID_A, title: "First", revision: 1, updatedAt: CREATED_AT },
        { id: ID_B, title: "Second", revision: 2, updatedAt: CREATED_AT },
      ]),
      getDocument: vi.fn((id: string) =>
        id === ID_A ? requestA.promise : requestB.promise,
      ),
    });
    render(<DocumentWorkspace client={client} />);
    const first = await screen.findByRole("button", { name: /^First/ });
    const second = screen.getByRole("button", { name: /^Second/ });

    act(() => {
      first.click();
      second.click();
    });
    expect(client.getDocument).toHaveBeenNthCalledWith(1, ID_A);
    expect(client.getDocument).toHaveBeenNthCalledWith(2, ID_B);

    await act(async () => {
      requestB.resolve(resource(ID_B, 2, envelopeB));
      await requestB.promise;
    });
    expect(screen.getByText("revision:2")).toBeInTheDocument();
    expect(editorHarness.editor.commands.setContent).toHaveBeenLastCalledWith(
      envelopeB.editor,
      { emitUpdate: false, errorOnInvalidContent: true },
    );
    expect(screen.getByText("state:saved")).toBeInTheDocument();

    await act(async () => {
      requestA.resolve(resource(ID_A, 1));
      await requestA.promise;
    });
    expect(screen.getByText("revision:2")).toBeInTheDocument();
    expect(editorHarness.editor.commands.setContent).toHaveBeenLastCalledWith(
      envelopeB.editor,
      { emitUpdate: false, errorOnInvalidContent: true },
    );
  });

  it("does not let stale A completion clear loading for pending B", async () => {
    const requestA = deferred<DocumentResource>();
    const requestB = deferred<DocumentResource>();
    const client = clientWith({
      listDocuments: vi.fn().mockResolvedValue([
        { id: ID_A, title: "First", revision: 1, updatedAt: CREATED_AT },
        { id: ID_B, title: "Second", revision: 2, updatedAt: CREATED_AT },
      ]),
      getDocument: vi.fn((id: string) =>
        id === ID_A ? requestA.promise : requestB.promise,
      ),
    });
    render(<DocumentWorkspace client={client} />);
    const first = await screen.findByRole("button", { name: /^First/ });
    const second = screen.getByRole("button", { name: /^Second/ });
    act(() => {
      first.click();
      second.click();
    });

    await act(async () => {
      requestA.resolve(resource(ID_A, 1));
      await requestA.promise;
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(editorHarness.editor.commands.setContent).not.toHaveBeenCalled();

    await act(async () => {
      requestB.resolve(resource(ID_B, 2, supportedEnvelope));
      await requestB.promise;
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("revision:2")).toBeInTheDocument();
  });

  it("ignores a stale A failure after B becomes the active document", async () => {
    const requestA = deferred<DocumentResource>();
    const requestB = deferred<DocumentResource>();
    const client = clientWith({
      listDocuments: vi.fn().mockResolvedValue([
        { id: ID_A, title: "First", revision: 1, updatedAt: CREATED_AT },
        { id: ID_B, title: "Second", revision: 2, updatedAt: CREATED_AT },
      ]),
      getDocument: vi.fn((id: string) =>
        id === ID_A ? requestA.promise : requestB.promise,
      ),
    });
    render(<DocumentWorkspace client={client} />);
    const first = await screen.findByRole("button", { name: /^First/ });
    const second = screen.getByRole("button", { name: /^Second/ });
    act(() => {
      first.click();
      second.click();
    });

    await act(async () => {
      requestB.resolve(resource(ID_B, 2, supportedEnvelope));
      await requestB.promise;
    });
    await act(async () => {
      requestA.reject(new Error("stale failure"));
      await expect(requestA.promise).rejects.toThrow("stale failure");
    });

    expect(screen.getByText("revision:2")).toBeInTheDocument();
    expect(screen.getByText("state:saved")).toBeInTheDocument();
    expect(screen.queryByText("state:failed")).not.toBeInTheDocument();
  });

  it("ignores a late document response after unmount", async () => {
    const request = deferred<DocumentResource>();
    const client = clientWith({
      listDocuments: vi.fn().mockResolvedValue([
        { id: ID_A, title: "First", revision: 1, updatedAt: CREATED_AT },
      ]),
      getDocument: vi.fn(() => request.promise),
    });
    const workspace = render(<DocumentWorkspace client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: /^First/ }));
    workspace.unmount();

    await act(async () => {
      request.resolve(resource(ID_A, 1, supportedEnvelope));
      await request.promise;
    });

    expect(editorHarness.editor.commands.setContent).not.toHaveBeenCalled();
    expect(useDocumentMetadata.getState().toMetadataCandidate()).toBeUndefined();
  });

  it("does not let a reload response replace a later document selection", async () => {
    const reloadA = deferred<DocumentResource>();
    const requestB = deferred<DocumentResource>();
    let requestsForA = 0;
    const client = clientWith({
      listDocuments: vi.fn().mockResolvedValue([
        { id: ID_A, title: "First", revision: 1, updatedAt: CREATED_AT },
        { id: ID_B, title: "Second", revision: 2, updatedAt: CREATED_AT },
      ]),
      getDocument: vi.fn((id: string) => {
        if (id === ID_B) return requestB.promise;
        requestsForA += 1;
        return requestsForA === 1
          ? Promise.resolve(resource(ID_A, 1, supportedEnvelope))
          : reloadA.promise;
      }),
      updateDocument: vi.fn().mockRejectedValue(new DocumentConflictError(2)),
    });
    render(
      <DocumentWorkspace client={client} confirmDiscard={() => true} />,
    );
    const first = await screen.findByRole("button", { name: /^First/ });
    fireEvent.click(first);
    await screen.findByText("revision:1");
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const reload = await screen.findByRole("button", {
      name: "Reload Server Version",
    });
    const secondAfterConflict = screen.getByRole("button", { name: /^Second/ });

    act(() => {
      reload.click();
      secondAfterConflict.click();
    });
    await act(async () => {
      requestB.resolve(resource(ID_B, 2, EmptyPersistedDocumentEnvelope));
      await requestB.promise;
    });
    await act(async () => {
      reloadA.resolve(resource(ID_A, 3, supportedEnvelope));
      await reloadA.promise;
    });

    expect(screen.getByText("revision:2")).toBeInTheDocument();
    expect(editorHarness.editor.commands.setContent).toHaveBeenLastCalledWith(
      EmptyPersistedDocumentEnvelope.editor,
      { emitUpdate: false, errorOnInvalidContent: true },
    );
  });
});
