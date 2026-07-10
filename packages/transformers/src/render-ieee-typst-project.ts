import { CompileRequestSchema, collectCiteKeys } from "@depress/ast";
import { AstValidationError } from "./ast-to-typst";
import { cslItemsToHayagriva } from "./csl-items-to-hayagriva";
import { renderValidatedIeeeTypstDocument } from "./render-ieee-typst-document";
import type { TypstCompileProject } from "./typst-compile-project";

export {
  TYPST_BIBLIOGRAPHY_FILE,
  TYPST_ENTRYPOINT_FILE,
  type TypstCompileProject,
} from "./typst-compile-project";

export function renderIeeeTypstProject(input: {
  ast: unknown;
  references: unknown;
}): TypstCompileProject {
  // Reuse the shared cross-boundary schema, including duplicate-id and
  // citation/reference integrity refinements. No transformer-local copy.
  const parsed = CompileRequestSchema.safeParse({
    ast: input.ast,
    references: input.references,
    templateId: "ieee",
    format: "pdf",
  });
  if (!parsed.success) {
    throw new AstValidationError(parsed.error.issues);
  }

  const citeKeys = collectCiteKeys(parsed.data.ast);
  if (citeKeys.length === 0) {
    return { main: renderValidatedIeeeTypstDocument(parsed.data.ast, false) };
  }

  const byId = new Map(parsed.data.references.map((item) => [item.id, item]));
  const citedReferences = citeKeys.map((citeKey) => byId.get(citeKey)!);
  return {
    main: renderValidatedIeeeTypstDocument(parsed.data.ast, true),
    bibliography: cslItemsToHayagriva(citedReferences),
  };
}
