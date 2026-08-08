// Mentor APIs are always same-origin in production. The optional public value
// exists only for the unchanged two-port local development workflow.
export function clientApiOrigin(): string {
  if (process.env["NODE_ENV"] === "production") return "";
  return process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";
}
