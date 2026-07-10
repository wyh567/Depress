import { describe, expect, it } from "vitest";
import { CslItemSchema } from "@depress/ast";
import { createCrossrefClient } from "./services/crossref/crossref-client";
import { crossrefWorkToCslItem } from "./services/crossref/crossref-work-to-csl";

// Opt-in live Crossref smoke — never runs in normal CI.
// DEPRESS_CROSSREF_SMOKE=1 pnpm --filter @depress/api test
describe.skipIf(process.env["DEPRESS_CROSSREF_SMOKE"] !== "1")(
  "Crossref live smoke",
  () => {
    it("looks up one known DOI and returns a valid CslItem", async () => {
      const client = createCrossrefClient({
        ...(process.env["CROSSREF_MAILTO"]
          ? { mailto: process.env["CROSSREF_MAILTO"] }
          : {}),
      });
      const doi = "10.1037/0003-066x.59.1.29";
      const lookup = await client.lookupWork(doi);
      expect(lookup.ok).toBe(true);
      if (!lookup.ok) return;
      const mapped = crossrefWorkToCslItem(lookup.work, doi);
      expect(mapped.ok).toBe(true);
      if (!mapped.ok) return;
      expect(CslItemSchema.parse(mapped.item).DOI).toBe(doi);
      expect(mapped.item.title.trim().length).toBeGreaterThan(0);
    }, 20_000);
  },
);
