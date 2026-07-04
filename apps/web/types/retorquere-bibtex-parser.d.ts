// 该包 v10.0.0 声明了 types 但未随包发布 dist/types;
// 这里只声明我们经映射层使用的最小 API 面。
declare module "@retorquere/bibtex-parser" {
  export interface ParsedCreator {
    lastName?: string;
    firstName?: string;
    name?: string;
  }

  export interface ParsedEntry {
    type: string;
    key: string;
    fields: Record<string, unknown>;
  }

  export interface ParsedError {
    error: string;
  }

  export interface ParseResult {
    errors: ParsedError[];
    entries: ParsedEntry[];
  }

  export interface ParseOptions {
    sentenceCase?: boolean;
  }

  export function parse(input: string, options?: ParseOptions): ParseResult;
}
