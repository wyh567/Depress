import { beforeEach, describe, expect, it } from "vitest";
import { useReferenceLibrary } from "./reference-library";

const smith = { id: "smith2024", type: "article-journal", title: "A Study" };

beforeEach(() => {
  useReferenceLibrary.getState().clear();
});

describe("reference-library store", () => {
  it("upsert 添加合法条目,has 可查", () => {
    useReferenceLibrary.getState().upsert(smith);
    expect(useReferenceLibrary.getState().items).toHaveLength(1);
    expect(useReferenceLibrary.getState().has("smith2024")).toBe(true);
  });

  it("upsert 拒绝非法条目(Zod 校验)", () => {
    expect(() => useReferenceLibrary.getState().upsert({ id: "  ", type: "book" })).toThrow();
    expect(useReferenceLibrary.getState().items).toHaveLength(0);
  });

  it("重复 id 确定性覆盖(后写入赢),不产生重复项", () => {
    useReferenceLibrary.getState().upsert(smith);
    useReferenceLibrary.getState().upsert({ ...smith, title: "Revised Study" });
    const items = useReferenceLibrary.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Revised Study");
  });

  it("remove 删除条目", () => {
    useReferenceLibrary.getState().upsert(smith);
    useReferenceLibrary.getState().remove("smith2024");
    expect(useReferenceLibrary.getState().has("smith2024")).toBe(false);
  });

  it("importBibtex 批量导入并逐条校验", () => {
    const { imported, errors } = useReferenceLibrary
      .getState()
      .importBibtex(
        `@article{a1, title = {T1}, journal = {J}, year = {2024}}\n@book{b1, title = {T2}, publisher = {P}, year = {2020}}`
      );
    expect(errors).toEqual([]);
    expect(imported).toBe(2);
    expect(useReferenceLibrary.getState().has("a1")).toBe(true);
    expect(useReferenceLibrary.getState().has("b1")).toBe(true);
  });
});
