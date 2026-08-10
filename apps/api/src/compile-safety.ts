export const DEFAULT_COMPILE_ACTIVE_JOB_LIMIT = 2;
export const MAX_COMPILE_ACTIVE_JOB_LIMIT = 100;

export const DEFAULT_COMPILE_SNAPSHOT_MAX_BYTES = 2_097_152;
export const MAX_COMPILE_SNAPSHOT_MAX_BYTES = 16_777_216;

export interface CompileSafetyOptions {
  compileActiveJobLimit?: number;
  compileSnapshotMaxBytes?: number;
}
