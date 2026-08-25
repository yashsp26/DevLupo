import crypto from "node:crypto";

import { EXECUTION_STATUS } from "./execution.types.js";

import { getExecutionRunner } from "./execution.service.js";

const sessions = new Map();

const SESSION_ID_BYTES = 24;

/*
 * Keep the number of simultaneously running executions
 * controlled at the application level.
 *
 * This is NOT a security sandbox.
 * It is only a process/session protection mechanism.
 */
const MAX_ACTIVE_SESSIONS = 20;

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

  /*
   * We currently use executeCode() for validation/runner
   * resolution.
   *
   * The actual interactive process will be started below
   * using the runner's startInteractive() method.
   */

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

    status: "starting",

    createdAt: Date.now(),

    lastActivityAt: Date.now(),

    process: null,

    controller: null,

    runner: runner.name ?? runner.constructor.name,

    stdout: "",

    stderr: "",

    exitCode: null,

    error: null,

    listeners: new Set(),
  };

  sessions.set(sessionId, session);

  try {
    const controller = await runner.startInteractive(normalizedRequest, {
      onStdout: (chunk) => {
        appendSessionOutput(session, "stdout", chunk);

        emitSessionEvent(session, {
          type: "stdout",
          data: chunk,
        });
      },

      onStderr: (chunk) => {
        appendSessionOutput(session, "stderr", chunk);

        emitSessionEvent(session, {
          type: "stderr",
          data: chunk,
        });
      },

      onExit: async ({ status, exitCode, error }) => {
        session.status = status;

        session.exitCode = exitCode;

        session.error = error;

        session.lastActivityAt = Date.now();

        emitSessionEvent(session, {
          type: "exit",

          status,

          exitCode,

          error,
        });

        /*
         * Give listeners a chance to receive the exit
         * event before removing the session.
         */
        setTimeout(() => {
          removeSession(session.id);
        }, 1000);
      },
    });

    session.controller = controller;

    session.process = controller.process;

    session.status = "running";

    session.lastActivityAt = Date.now();

    emitSessionEvent(session, {
      type: "ready",

      sessionId: session.id,
    });

    return getSessionInfo(session);
  } catch (error) {
    sessions.delete(sessionId);

    throw error;
  }
}

/*
 * ============================================================
 * Input
 * ============================================================
 */

export function writeSessionInput(userId, sessionId, input) {
  const session = getOwnedSession(userId, sessionId);

  if (session.status !== "running" && session.status !== "starting") {
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

  const written = session.controller.writeStdin(input);

  if (!written) {
    const error = new Error("Unable to write to the execution process.");

    error.code = "STDIN_WRITE_FAILED";

    throw error;
  }

  session.lastActivityAt = Date.now();

  /*
   * Echo input as a session event only when needed
   * by the frontend.
   *
   * The actual process output will still arrive through
   * stdout/stderr.
   */
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

  if (!session.controller) {
    return getSessionInfo(session);
  }

  session.controller.closeStdin();

  session.lastActivityAt = Date.now();

  return getSessionInfo(session);
}

/*
 * ============================================================
 * Terminate execution
 * ============================================================
 */

export function terminateExecutionSession(userId, sessionId) {
  const session = getOwnedSession(userId, sessionId);

  if (!session.controller) {
    removeSession(sessionId);

    return {
      success: true,
    };
  }

  session.controller.terminate();

  session.lastActivityAt = Date.now();

  return {
    success: true,
  };
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

/*
 * ============================================================
 * Subscribe to session events
 * ============================================================
 */

export function subscribeToExecutionSession(userId, sessionId, listener) {
  const session = getOwnedSession(userId, sessionId);

  if (typeof listener !== "function") {
    throw new Error("Session listener must be a function.");
  }

  session.listeners.add(listener);

  /*
   * Return unsubscribe function.
   */
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

    lastActivityAt: session.lastActivityAt,

    stdout: session.stdout,

    stderr: session.stderr,

    exitCode: session.exitCode,

    error: session.error,
  };
}

/*
 * ============================================================
 * Ownership protection
 * ============================================================
 */

function getOwnedSession(userId, sessionId) {
  const session = sessions.get(sessionId);

  if (!session) {
    const error = new Error("Execution session not found.");

    error.code = "SESSION_NOT_FOUND";

    throw error;
  }

  if (session.userId !== String(userId)) {
    /*
     * Deliberately do not reveal whether the session exists.
     */
    const error = new Error("Execution session not found.");

    error.code = "SESSION_NOT_FOUND";

    throw error;
  }

  return session;
}

/*
 * ============================================================
 * Session events
 * ============================================================
 */

function emitSessionEvent(session, event) {
  for (const listener of session.listeners) {
    try {
      listener(event);
    } catch {
      /*
       * A broken listener must never break the execution
       * process itself.
       */
    }
  }
}

/*
 * ============================================================
 * Output accumulation
 * ============================================================
 */

const MAX_STORED_OUTPUT = 1024 * 1024;

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
 * Runner lookup
 * ============================================================
 *
 * We intentionally keep runner lookup here small.
 *
 * The actual runner registry should eventually live in
 * execution.service.js so both normal and interactive
 * execution use exactly the same registry.
 */

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

/*
 * ============================================================
 * Session removal
 * ============================================================
 */

function removeSession(sessionId) {
  const session = sessions.get(sessionId);

  if (!session) {
    return;
  }

  sessions.delete(sessionId);

  session.listeners.clear();
}

/*
 * ============================================================
 * Active session count
 * ============================================================
 */

export function getActiveSessionCount() {
  return sessions.size;
}

/*
 * ============================================================
 * Cleanup
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
  }

  sessions.clear();
}
