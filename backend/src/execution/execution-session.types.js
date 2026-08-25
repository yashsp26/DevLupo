export const EXECUTION_SESSION_STATUS = Object.freeze({
  CREATED: "created",
  STARTING: "starting",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  TIMEOUT: "timeout",
  TERMINATED: "terminated",
});

export const EXECUTION_SESSION_MESSAGE = Object.freeze({
  READY: "ready",
  STARTED: "started",
  STDOUT: "stdout",
  STDERR: "stderr",
  INPUT: "input",
  EXIT: "exit",
  ERROR: "error",
  TERMINATED: "terminated",
});

export function createExecutionSession({ id, userId, request }) {
  return {
    id,
    userId,
    request,

    status: EXECUTION_SESSION_STATUS.CREATED,

    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,

    process: null,
    timeoutHandle: null,

    stdout: "",
    stderr: "",

    exitCode: null,
    result: null,
  };
}
