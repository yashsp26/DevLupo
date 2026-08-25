export const PREVIEW_STATUS = Object.freeze({
  STARTING: "starting",
  RUNNING: "running",
  STOPPING: "stopping",
  STOPPED: "stopped",
  EXPIRED: "expired",
});

export const PREVIEW_TTL_MS = 10 * 60 * 1000;

export const MAX_PREVIEWS = 20;

export const MAX_OUTPUT_SIZE = 1024 * 1024;