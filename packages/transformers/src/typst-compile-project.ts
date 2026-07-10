// Fixed-shape trusted compiler input. Callers provide file contents only;
// filenames and the entrypoint are code-owned constants, so no path can enter
// the sandbox API.
export const TYPST_ENTRYPOINT_FILE = "main.typ";
export const TYPST_BIBLIOGRAPHY_FILE = "references.yml";

export type TypstCompileProject = Readonly<{
  main: string;
  bibliography?: string;
}>;
