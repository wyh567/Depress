// @vitest-environment jsdom
import type { CslItem } from "@depress/ast";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CitationPrompt } from "./editor/citation-prompt";
import { AddReferenceForm } from "./library/add-reference-form";
import { LibraryPanel } from "./library/library-panel";
import { useReferenceLibrary } from "@/stores/reference-library";

const api = vi.hoisted(() => ({
  listReferences: vi.fn(),
  createReference: vi.fn(),
  updateReference: vi.fn(),
  deleteReference: vi.fn(),
}));

vi.mock("@/lib/reference-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reference-client")>();
  return {
    ...actual,
    referenceClient: api,
  };
});

const item: CslItem = {
  id: "smith2024",
  type: "article-journal",
  title: "Persisted article",
  author: [{ family: "Smith" }],
  issued: { "date-parts": [[2024]] },
};

describe("persisted reference library UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listReferences.mockResolvedValue([item]);
    api.createReference.mockImplementation(async (candidate: CslItem) => candidate);
    api.updateReference.mockImplementation(
      async (_identity: string, candidate: CslItem) => candidate,
    );
    api.deleteReference.mockResolvedValue(undefined);
    useReferenceLibrary.getState().clear();
    useReferenceLibrary.setState({
      items: [item],
      lastConfirmedItems: [item],
      activeUserId: "user-a",
    });
  });

  it("uses the persisted project library as the citation picker source", () => {
    const confirm = vi.fn();
    render(<CitationPrompt onConfirm={confirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Persisted article/ }));
    expect(confirm).toHaveBeenCalledWith("smith2024");
  });

  it("updates through the server and retains the same citeKey identity", async () => {
    render(<LibraryPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Edit smith2024" }));
    fireEvent.change(screen.getByLabelText("Edit title smith2024"), {
      target: { value: "Updated persisted article" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save reference" }));

    await waitFor(() =>
      expect(api.updateReference).toHaveBeenCalledWith(
        "smith2024",
        expect.objectContaining({
          id: "smith2024",
          title: "Updated persisted article",
        }),
      ),
    );
    expect(useReferenceLibrary.getState().items[0]).toMatchObject({
      id: "smith2024",
      title: "Updated persisted article",
    });
  });

  it("warns before deletion and never removes citation nodes implicitly", async () => {
    const rejectDelete = vi.fn(() => false);
    const first = render(<LibraryPanel confirmDelete={rejectDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete smith2024" }));
    expect(rejectDelete).toHaveBeenCalledWith(
      expect.stringContaining("citations will remain"),
    );
    expect(api.deleteReference).not.toHaveBeenCalled();
    expect(useReferenceLibrary.getState().items).toEqual([item]);
    first.unmount();

    render(<LibraryPanel confirmDelete={() => true} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete smith2024" }));
    await waitFor(() => expect(api.deleteReference).toHaveBeenCalledWith("smith2024"));
    expect(useReferenceLibrary.getState().items).toEqual([]);
  });

  it("does not silently discard an invalid manually entered year", async () => {
    render(<AddReferenceForm />);
    fireEvent.change(screen.getByLabelText("citeKey"), {
      target: { value: "invalid-year" },
    });
    fireEvent.change(screen.getByLabelText("Reference title"), {
      target: { value: "Manual reference" },
    });
    fireEvent.change(screen.getByLabelText("Reference year"), {
      target: { value: "2024.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("year is invalid");
    expect(api.createReference).not.toHaveBeenCalled();
  });
});
