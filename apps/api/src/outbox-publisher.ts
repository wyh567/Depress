import { setTimeout as delay } from "node:timers/promises";
import type { PublishOutboxResult } from "./services/compile-outbox-publisher";

export interface OutboxPublisherLogger {
  info(fields: Record<string, number>, message: string): void;
  warn(message: string): void;
}

export async function runOutboxPublisher(options: {
  publish: () => Promise<PublishOutboxResult>;
  pollIntervalMs: number;
  signal: AbortSignal;
  logger: OutboxPublisherLogger;
}): Promise<void> {
  while (!options.signal.aborted) {
    try {
      const result = await options.publish();
      if (result.selected > 0) {
        options.logger.info(
          {
            selected: result.selected,
            published: result.published,
            failed: result.failed,
          },
          "Compile outbox poll completed"
        );
      }
    } catch {
      // Dependency details may contain credentials or internal addresses.
      options.logger.warn("Compile outbox poll failed");
    }

    if (options.signal.aborted) break;
    try {
      await delay(options.pollIntervalMs, undefined, { signal: options.signal });
    } catch (error) {
      if (!options.signal.aborted) throw error;
    }
  }
}
