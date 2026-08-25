import crypto from "node:crypto";

import { getExecutionRunner } from "./execution.service.js";
import { EXECUTION_SESSION_STATUS } from "./execution-session.types.js";

const sessions = new Map();

const SESSION_ID_BYTES = 24;
const SESSION_TTL_MS = 5 * 60 * 1000;

const MAX_ACTIVE_SESSIONS = 20;
const MAX_STORED_OUTPUT = 1024 * 1024;

/*
 * ============================================================
 * Session creation
 * ============================================================
 */

export async function createExecutionSession({ userId, request }) {
  if (!userId) {
    throw new Error("User ID is required to create an execution session.");
  }

  if (!request) {
    throw new Error("Execution request is required.");
  }

  if (getActiveSessionCount() >= MAX_ACTIVE_SESSIONS) {
    const error = new Error(
      "The execution server is currently busy. Please try again later.",
    );

    error.code = "EXECUTION_CAPACITY_REACHED";

    throw error;
  }

  const normalizedRequest = normalizeRequest(request);

  const runner = getExecutionRunner(normalizedRequest);

  if (!runner) {
    const error = new Error(
      `No execution runner available for language "${normalizedRequest.language}" with runtime "${normalizedRequest.runtime}".`,
    );

    error.code = "NO_EXECUTION_RUNNER";

    throw error;
  }

  if (typeof runner.startInteractive !== "function") {
    const error = new Error(
      `Runner "${runner.name ?? runner.constructor.name}" does not support interactive execution.`,
    );

    error.code = "INTERACTIVE_EXECUTION_NOT_SUPPORTED";

    throw error;
  }

  const sessionId = crypto.randomBytes(SESSION_ID_BYTES).toString("hex");

  const session = {
    id: sessionId,

    userId: String(userId),

    request: normalizedRequest,

    status: EXECUTION_SESSION_STATUS.STARTING,

    createdAt: Date.now(),

    startedAt: null,

    finishedAt: null,

    lastActivityAt: Date.now(),

    process: null,

    controller: null,

    runner: runner.name ?? runner.constructor.name,

    stdout: "",

    stderr: "",

    exitCode: null,

    error: null,

    listeners: new Set(),

    timeoutHandle: null,
  };

  sessions.set(sessionId, session);

  scheduleSessionCleanup(sessionId);

  try {
    const controller = await runner.startInteractive(normalizedRequest, {
      onStdout: (chunk) => {
        appendSessionOutput(session, "stdout", chunk);

        touchSession(session);

        emitSessionEvent(session, {
          type: "stdout",
          data: chunk,
        });
      },

      onStderr: (chunk) => {
        appendSessionOutput(session, "stderr", chunk);

        touchSession(session);

        emitSessionEvent(session, {
          type: "stderr",
          data: chunk,
        });
      },

      onExit: ({ status, exitCode, error }) => {
        session.status = status;

        session.exitCode = exitCode;

        session.error = error ?? null;

        session.finishedAt = Date.now();

        touchSession(session);

        emitSessionEvent(session, {
          type: "exit",
          status,
          exitCode,
          error: error ?? null,
        });

        /*
         * Give connected clients a short
         * window to receive the exit event.
         */
        setTimeout(() => {
          removeSession(session.id);
        }, 1000).unref?.();
      },
    });

    session.controller = controller;

    session.status = EXECUTION_SESSION_STATUS.STARTING;

    session.process = controller.process;

    session.status = EXECUTION_SESSION_STATUS.RUNNING;

    session.startedAt = Date.now();

    touchSession(session);

    emitSessionEvent(session, {
      type: "ready",
      sessionId: session.id,
    });

    return getSessionInfo(session);
  } catch (error) {
    removeSession(sessionId);

    throw error;
  }
}

/*
 * ============================================================
 * Session lookup
 * ============================================================
 */

export function getExecutionSession(userId, sessionId) {
  const session = getOwnedSession(userId, sessionId);

  return getSessionInfo(session);
}

export function getSession(sessionId) {
  return sessions.get(sessionId) ?? null;
}

/*
 * ============================================================
 * Input
 * ============================================================
 */

export function writeSessionInput(userId, sessionId, input) {
  const session = getOwnedSession(userId, sessionId);

  if (
    session.status !== EXECUTION_SESSION_STATUS.RUNNING &&
    session.status !== EXECUTION_SESSION_STATUS.STARTING
  ) {
    const error = new Error("Execution session is no longer running.");

    error.code = "SESSION_NOT_RUNNING";

    throw error;
  }

  if (
    !session.controller ||
    typeof session.controller.writeStdin !== "function"
  ) {
    const error = new Error("Execution session input is unavailable.");

    error.code = "SESSION_INPUT_UNAVAILABLE";

    throw error;
  }

  const written = session.controller.writeStdin(String(input ?? ""));

  if (!written) {
    const error = new Error("Unable to write to the execution process.");

    error.code = "STDIN_WRITE_FAILED";

    throw error;
  }

  touchSession(session);

  emitSessionEvent(session, {
    type: "stdin",
    data: String(input ?? ""),
  });

  return getSessionInfo(session);
}

/*
 * ============================================================
 * Close stdin
 * ============================================================
 */

export function closeSessionInput(userId, sessionId) {
  const session = getOwnedSession(userId, sessionId);

  if (
    session.controller &&
    typeof session.controller.closeStdin === "function"
  ) {
    session.controller.closeStdin();
  }

  touchSession(session);

  return getSessionInfo(session);
}

/*
 * ============================================================
 * Termination
 * ============================================================
 */

export function terminateExecutionSession(userId, sessionId) {
  const session = getOwnedSession(userId, sessionId);

  try {
    session.controller?.terminate();
  } catch {
    // Ignore process termination errors.
  }

  session.status = EXECUTION_SESSION_STATUS.TERMINATED;

  session.finishedAt = Date.now();

  touchSession(session);

  emitSessionEvent(session, {
    type: "terminated",
    status: EXECUTION_SESSION_STATUS.TERMINATED,
  });

  setTimeout(() => {
    removeSession(sessionId);
  }, 1000).unref?.();

  return {
    success: true,
  };
}

/*
 * ============================================================
 * Event subscription
 * ============================================================
 */

export function subscribeToExecutionSession(userId, sessionId, listener) {
  const session = getOwnedSession(userId, sessionId);

  if (typeof listener !== "function") {
    throw new Error("Session listener must be a function.");
  }

  session.listeners.add(listener);

  return () => {
    session.listeners.delete(listener);
  };
}

/*
 * ============================================================
 * Session information
 * ============================================================
 */

function getSessionInfo(session) {
  return {
    id: session.id,

    status: session.status,

    runner: session.runner,

    createdAt: session.createdAt,

    startedAt: session.startedAt,

    finishedAt: session.finishedAt,

    lastActivityAt: session.lastActivityAt,

    stdout: session.stdout,

    stderr: session.stderr,

    exitCode: session.exitCode,

    error: session.error,
  };
}

/*
 * ============================================================
 * Ownership
 * ============================================================
 */

function getOwnedSession(userId, sessionId) {
  const session = sessions.get(sessionId);

  if (!session) {
    throwSessionNotFound();
  }

  if (session.userId !== String(userId)) {
    throwSessionNotFound();
  }

  return session;
}

function throwSessionNotFound() {
  const error = new Error("Execution session not found.");

  error.code = "SESSION_NOT_FOUND";

  throw error;
}

/*
 * ============================================================
 * Events
 * ============================================================
 */

function emitSessionEvent(session, event) {
  for (const listener of session.listeners) {
    try {
      listener(event);
    } catch {
      /*
       * A broken WebSocket/listener must
       * never break execution.
       */
    }
  }
}

/*
 * ============================================================
 * Output
 * ============================================================
 */

function appendSessionOutput(session, stream, chunk) {
  if (!chunk) {
    return;
  }

  if (stream === "stdout") {
    session.stdout += chunk;

    if (session.stdout.length > MAX_STORED_OUTPUT) {
      session.stdout = session.stdout.slice(0, MAX_STORED_OUTPUT);
    }

    return;
  }

  if (stream === "stderr") {
    session.stderr += chunk;

    if (session.stderr.length > MAX_STORED_OUTPUT) {
      session.stderr = session.stderr.slice(0, MAX_STORED_OUTPUT);
    }
  }
}

/*
 * ============================================================
 * Activity
 * ============================================================
 */

function touchSession(session) {
  session.lastActivityAt = Date.now();
}

/*
 * ============================================================
 * TTL cleanup
 * ============================================================
 */

function scheduleSessionCleanup(sessionId) {
  const timeoutHandle = setTimeout(() => {
    const session = sessions.get(sessionId);

    if (!session) {
      return;
    }

    if (
      session.status === EXECUTION_SESSION_STATUS.STARTING ||
      session.status === EXECUTION_SESSION_STATUS.RUNNING
    ) {
      try {
        session.controller?.terminate();
      } catch {
        // Ignore cleanup errors.
      }

      session.status = EXECUTION_SESSION_STATUS.TIMEOUT;

      session.finishedAt = Date.now();

      emitSessionEvent(session, {
        type: "exit",
        status: EXECUTION_SESSION_STATUS.TIMEOUT,
        exitCode: null,
        error: {
          message: "Execution session expired.",
          code: "SESSION_TTL_EXPIRED",
        },
      });
    }

    removeSession(sessionId);
  }, SESSION_TTL_MS);

  timeoutHandle.unref?.();

  const session = sessions.get(sessionId);

  if (session) {
    session.timeoutHandle = timeoutHandle;
  }
}

/*
 * ============================================================
 * Removal
 * ============================================================
 */

function removeSession(sessionId) {
  const session = sessions.get(sessionId);

  if (!session) {
    return;
  }

  if (session.timeoutHandle) {
    clearTimeout(session.timeoutHandle);
    session.timeoutHandle = null;
  }

  sessions.delete(sessionId);

  session.listeners.clear();
}

/*
 * ============================================================
 * Capacity
 * ============================================================
 */

export function getActiveSessionCount() {
  return sessions.size;
}

/*
 * ============================================================
 * Application shutdown
 * ============================================================
 */

export async function cleanupExecutionSessions() {
  const activeSessions = [...sessions.values()];

  for (const session of activeSessions) {
    try {
      session.controller?.terminate();
    } catch {
      // Ignore cleanup errors.
    }

    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
    }

    session.listeners.clear();
  }

  sessions.clear();
}

/*
 * ============================================================
 * Request normalization
 * ============================================================
 */

function normalizeRequest(request) {
  return {
    ...request,

    language: String(request.language ?? "")
      .trim()
      .toLowerCase(),

    runtime: String(request.runtime ?? request.framework ?? "node")
      .trim()
      .toLowerCase(),

    framework: request.framework
      ? String(request.framework).trim().toLowerCase()
      : undefined,

    entryPoint: String(request.entryPoint ?? "index.js").trim(),

    files: Array.isArray(request.files)
      ? request.files.map((file) => ({
          path: String(file.path ?? "").trim(),

          content: String(file.content ?? ""),
        }))
      : [],

    stdin: String(request.stdin ?? ""),

    timeoutMs: Number(request.timeoutMs ?? 10000),
  };
}
