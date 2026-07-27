import { describe, expect, it } from "vitest";
import {
  buildMetadataCandidate,
  metadataToDraft,
  type DocumentMetadataDraft,
} from "./document-metadata";

const empty: DocumentMetadataDraft = {
  title: "",
  abstract: "",
  keywordsText: "",
  authorsText: "",
  affiliationsText: "",
};

describe("buildMetadataCandidate", () => {
  it("returns undefined when the form is empty", () => {
    expect(buildMetadataCandidate(empty)).toBeUndefined();
  });

  it("builds title/abstract/keywords/authors/affiliations", () => {
    expect(
      buildMetadataCandidate({
        title: "  Real Title  ",
        abstract: "  Abs  ",
        keywordsText: "AST, Typst, AST",
        authorsText: "Ada | aff-1\n王伟 | aff-1,aff-2",
        affiliationsText: "aff-1 | Lab One\naff-2 | 学院",
      }),
    ).toEqual({
      title: "Real Title",
      abstract: "Abs",
      keywords: ["AST", "Typst", "AST"],
      authors: [
        { name: "Ada", affiliationIds: ["aff-1"] },
        { name: "王伟", affiliationIds: ["aff-1", "aff-2"] },
      ],
      affiliations: [
        { id: "aff-1", name: "Lab One" },
        { id: "aff-2", name: "学院" },
      ],
    });
  });

  it("hydrates every supported semantic metadata field without loss", () => {
    const metadata = {
      title: "Restored title",
      abstract: "Restored abstract",
      keywords: ["one", "two"],
      authors: [
        { name: "Ada", affiliationIds: ["lab-1"] },
        { name: "Grace" },
      ],
      affiliations: [{ id: "lab-1", name: "Research Lab" }],
    };
    expect(buildMetadataCandidate(metadataToDraft(metadata))).toEqual(metadata);
  });
});
