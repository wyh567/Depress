import {
  CompileRequestSchema,
  collectCiteKeys,
  type CompileTemplateId,
} from "@depress/ast";
import { AstValidationError } from "./ast-to-typst";
import { cslItemsToHayagriva } from "./csl-items-to-hayagriva";
import { renderValidatedElsevierTypstDocument } from "./render-elsevier-typst-document";
import { renderValidatedIeeeTypstDocument } from "./render-ieee-typst-document";
import type { TypstCompileProject } from "./typst-compile-project";

export {
  TYPST_BIBLIOGRAPHY_FILE,
  TYPST_ENTRYPOINT_FILE,
  type TypstCompileProject,
} from "./typst-compile-project";

export type RenderTypstProjectInput = Readonly<{
  ast: unknown;
  references: unknown;
  templateId: unknown;
}>;

function assertNever(templateId: never): never {
  throw new Error(`Unsupported compile template: ${templateId}`);
}

function renderTemplate(
  templateId: CompileTemplateId,
  ast: Parameters<typeof renderValidatedIeeeTypstDocument>[0],
  withBibliography: boolean,
): string {
  switch (templateId) {
    case "ieee":
      return renderValidatedIeeeTypstDocument(ast, withBibliography);
    case "elsevier":
      return renderValidatedElsevierTypstDocument(ast, withBibliography);
  }
  return assertNever(templateId);
}

export function renderTypstProject(input: RenderTypstProjectInput): TypstCompileProject {
  const parsed = CompileRequestSchema.safeParse({
    ast: input.ast,
    references: input.references,
    templateId: input.templateId,
    format: "pdf",
  });
  if (!parsed.success) {
    throw new AstValidationError(parsed.error.issues);
  }

  const citeKeys = collectCiteKeys(parsed.data.ast);
  const withBibliography = citeKeys.length > 0;
  const main = renderTemplate(
    parsed.data.templateId,
    parsed.data.ast,
    withBibliography,
  );
  if (!withBibliography) {
    return { main };
  }

  const referencesById = new Map(
    parsed.data.references.map((reference) => [reference.id, reference]),
  );
  const citedReferences = citeKeys.map((citeKey) => referencesById.get(citeKey)!);
  return { main, bibliography: cslItemsToHayagriva(citedReferences) };
}

export function renderIeeeTypstProject(input: {
  ast: unknown;
  references: unknown;
}): TypstCompileProject {
  return renderTypstProject({ ...input, templateId: "ieee" });
}

export function renderElsevierTypstProject(input: {
  ast: unknown;
  references: unknown;
}): TypstCompileProject {
  return renderTypstProject({ ...input, templateId: "elsevier" });
}