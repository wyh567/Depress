import { describe, expect, it } from "vitest";
import {
  buildMetadataCandidate,
  metadataToDraft,
  type DocumentMetadataDraft,
} from "./document-metadata";

const empty: DocumentMetadataDraft = {
  title: "",
  titleEn: "",
  abstract: "",
  abstractEn: "",
  keywordsText: "",
  keywordsEnText: "",
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
        titleEn: "",
        abstract: "  Abs  ",
        abstractEn: "",
        keywordsText: "AST, Typst, AST",
        keywordsEnText: "",
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

  it("builds bilingual English metadata and nameEn fields", () => {
    expect(
      buildMetadataCandidate({
        title: "结构化编辑",
        titleEn: " Structured Editing ",
        abstract: "中文摘要",
        abstractEn: " English abstract ",
        keywordsText: "学术出版",
        keywordsEnText: "AST, Typst",
        authorsText: "王伟 / WANG Wei | aff-1",
        affiliationsText: "aff-1 | 计算机学院 / School of CS",
      }),
    ).toEqual({
      title: "结构化编辑",
      titleEn: "Structured Editing",
      abstract: "中文摘要",
      abstractEn: "English abstract",
      keywords: ["学术出版"],
      keywordsEn: ["AST", "Typst"],
      authors: [
        { name: "王伟", nameEn: "WANG Wei", affiliationIds: ["aff-1"] },
      ],
      affiliations: [
        {
          id: "aff-1",
          name: "计算机学院",
          nameEn: "School of CS",
        },
      ],
    });
  });

  it("hydrates every supported semantic metadata field without loss", () => {
    const metadata = {
      title: "Restored title",
      titleEn: "Restored English title",
      abstract: "Restored abstract",
      abstractEn: "Restored English abstract",
      keywords: ["one", "two"],
      keywordsEn: ["one-en", "two-en"],
      authors: [
        { name: "Ada", nameEn: "ADA", affiliationIds: ["lab-1"] },
        { name: "Grace" },
      ],
      affiliations: [
        { id: "lab-1", name: "Research Lab", nameEn: "Research Lab EN" },
      ],
    };
    expect(buildMetadataCandidate(metadataToDraft(metadata))).toEqual(metadata);
  });
});
