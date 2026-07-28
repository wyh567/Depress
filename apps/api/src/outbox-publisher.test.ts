import { describe, expect, it, vi } from "vitest";
import { runOutboxPublisher } from "./outbox-publisher";

describe("outbox publisher loop", () => {
  it("polls a bounded batch and stops gracefully", async () => {
    const controller = new AbortController();
    const logger = { info: vi.fn(), warn: vi.fn() };
    const publish = vi.fn(async () => {
      controller.abort();
      return { selected: 1, published: 1, failed: 0 };
    });

    await runOutboxPublisher({
      publish,
      pollIntervalMs: 100,
      signal: controller.signal,
      logger,
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { selected: 1, published: 1, failed: 0 },
      "Compile outbox poll completed"
    );
  });

  it("does not log dependency error details", async () => {
    const controller = new AbortController();
    const logger = { info: vi.fn(), warn: vi.fn() };
    const publish = vi.fn(async () => {
      controller.abort();
      throw new Error("redis://secret@internal");
    });

    await runOutboxPublisher({
      publish,
      pollIntervalMs: 100,
      signal: controller.signal,
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith("Compile outbox poll failed");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("redis://");
  });
});
