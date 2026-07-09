import { describe, expect, it } from "vitest";
import { bibtexToCsl } from "./bibtex-to-csl";

describe("bibtexToCsl 类型映射", () => {
  it("@article → article-journal,entry key 保留为 id", () => {
    const { items, errors } = bibtexToCsl(
      `@article{smith2024, author = {Smith, John}, title = {A Study}, journal = {Nature}, year = {2024}}`
    );
    expect(errors).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "smith2024",
      type: "article-journal",
      title: "A Study",
      author: [{ family: "Smith", given: "John" }],
      issued: { "date-parts": [[2024]] },
      "container-title": "Nature",
    });
  });

  it("@book → book,publisher 映射到 CSL publisher", () => {
    const { items } = bibtexToCsl(
      `@book{knuth1997, author = {Knuth, Donald E.}, title = {The Art of Computer Programming}, publisher = {Addison-Wesley}, year = {1997}}`
    );
    expect(items[0]).toMatchObject({
      id: "knuth1997",
      type: "book",
      title: "The Art of Computer Programming",
      author: [{ family: "Knuth", given: "Donald E." }],
      issued: { "date-parts": [[1997]] },
      publisher: "Addison-Wesley",
    });
  });

  it("@inproceedings → paper-conference,booktitle → container-title", () => {
    const { items } = bibtexToCsl(
      `@inproceedings{li2023, author = {Li, Hua}, title = {Deep Learning}, booktitle = {Proc. of ICML}, year = {2023}}`
    );
    expect(items[0]).toMatchObject({
      id: "li2023",
      type: "paper-conference",
      "container-title": "Proc. of ICML",
    });
  });

  it("未知 BibTeX 类型 → document", () => {
    const { items } = bibtexToCsl(`@misc{note2024, title = {Some Note}, year = {2024}}`);
    expect(items[0]?.type).toBe("document");
  });

  it("中文作者(不拆分)→ literal", () => {
    const { items } = bibtexToCsl(
      `@article{wang2023, author = {王伟 and Smith, John}, title = {中文论文标题}, journal = {计算机学报}, year = {2023}}`
    );
    expect(items[0]?.author).toEqual([{ literal: "王伟" }, { family: "Smith", given: "John" }]);
    expect(items[0]?.title).toBe("中文论文标题");
  });

  it("DOI 特殊字符原样保留", () => {
    const doi = "10.1000/j.issn.1234-5678(2024)01_<v2>;x";
    const { items } = bibtexToCsl(
      `@article{d1, title = {T}, journal = {J}, year = {2024}, doi = {${doi}}}`
    );
    expect(items[0]?.DOI).toBe(doi);
  });

  it("映射 volume/number/pages/url 到 CSL 字段", () => {
    const { items, errors } = bibtexToCsl(
      `@article{m1, title = {T}, journal = {J}, year = {2024}, volume = {12}, number = {3}, pages = {10--20}, url = {https://example.com/m1}}`
    );
    expect(errors).toEqual([]);
    expect(items[0]).toMatchObject({
      volume: "12",
      issue: "3",
      URL: "https://example.com/m1",
    });
    // Parser may normalize BibTeX `--` to an en-dash; accept either form.
    expect(items[0]?.page).toBeDefined();
    expect(items[0]?.page).toMatch(/10/);
    expect(items[0]?.page).toMatch(/20/);
  });

  it("未知/多余字段不破坏导入", () => {
    const { items, errors } = bibtexToCsl(
      `@article{x1, title = {T}, journal = {J}, year = {2024}, note = {ignore me}, abstract = {also ignored}}`
    );
    expect(errors).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "x1", title: "T" });
  });

  it("非法 BibTeX 返回 errors 而不抛异常", () => {
    const { items, errors } = bibtexToCsl(`@article{broken, title = }`);
    expect(items).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });
});
