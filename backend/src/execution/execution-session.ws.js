import { WebSocketServer, WebSocket } from "ws";

import prisma from "../config/prisma.js";
import { verifyAccessToken } from "../utils/jwt.js";

import {
  getExecutionSession,
  subscribeToExecutionSession,
  writeSessionInput,
  closeSessionInput,
  terminateExecutionSession,
} from "./execution-session.manager.js";


/**
 * WebSocket transport for interactive execution sessions.
 *
 * Responsibilities:
 * - Authenticate the WebSocket connection.
 * - Validate the execution session.
 * - Verify session ownership.
 * - Stream stdout/stderr to the client.
 * - Forward stdin from the client to the execution process.
 * - Close stdin.
 * - Terminate execution.
 *
 * It does NOT:
 * - create execution processes
 * - execute code
 * - load projects
 * - manage Node.js child processes
 *
 * Those responsibilities belong to the execution session manager
 * and execution runners.
 */

const WS_PATH = "/api/v1/execution/ws";

let webSocketServer = null;

/*
 * ============================================================
 * WebSocket server initialization
 * ============================================================
 */

export function initializeExecutionWebSocket(server) {
  if (webSocketServer) {
    return webSocketServer;
  }

  webSocketServer = new WebSocketServer({
    server,
    path: WS_PATH,
  });

  webSocketServer.on("connection", handleConnection);

  webSocketServer.on("error", (error) => {
    console.error("[Execution WebSocket] Server error:", error);
  });

  console.log(`[Execution WebSocket] Listening on ${WS_PATH}`);

  return webSocketServer;
}

/*
 * ============================================================
 * Connection handling
 * ============================================================
 */

async function handleConnection(socket, request) {
  let sessionId = null;
  let userId = null;
  let unsubscribe = null;

  try {
    /*
     * ---------------------------------------------------------
     * 1. Authenticate connection
     * ---------------------------------------------------------
     */

    const user = await authenticateWebSocket(request);

    if (!user?.id) {
      sendError(socket, "Authentication required.", "UNAUTHORIZED");

      socket.close(1008, "Authentication required.");

      return;
    }

    userId = String(user.id);

    /*
     * ---------------------------------------------------------
     * 2. Read session id
     * ---------------------------------------------------------
     */

    const url = new URL(
      request.url,
      `http://${request.headers.host || "localhost"}`,
    );

    sessionId = url.searchParams.get("sessionId");

    if (!sessionId) {
      sendError(
        socket,
        "Execution session id is required.",
        "SESSION_ID_REQUIRED",
      );

      socket.close(1008, "Session id required.");

      return;
    }

    /*
     * ---------------------------------------------------------
     * 3. Verify session ownership
     * ---------------------------------------------------------
     *
     * getExecutionSession() uses the same ownership protection
     * as the REST session APIs.
     */

    let session;

    try {
      session = getExecutionSession(userId, sessionId);
    } catch (error) {
      sendError(
        socket,
        error?.message || "Execution session not found.",
        error?.code || "SESSION_NOT_FOUND",
      );

      socket.close(1008, "Execution session not found.");

      return;
    }

    /*
     * ---------------------------------------------------------
     * 4. Send connection state
     * ---------------------------------------------------------
     */

    send(socket, {
      type: "connected",
      sessionId,
    });

    /*
     * Send the current session state immediately.
     *
     * This is important if the WebSocket connects after the
     * execution has already produced some output.
     */

    send(socket, {
      type: "session",
      session: {
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
      },
    });

    /*
     * ---------------------------------------------------------
     * 5. Subscribe to live execution events
     * ---------------------------------------------------------
     */

    unsubscribe = subscribeToExecutionSession(userId, sessionId, (event) => {
      handleSessionEvent(socket, sessionId, event);
    });

    /*
     * ---------------------------------------------------------
     * 6. Client messages
     * ---------------------------------------------------------
     */

    socket.on("message", (rawMessage) => {
      void handleClientMessage(socket, userId, sessionId, rawMessage);
    });

    /*
     * ---------------------------------------------------------
     * 7. Connection close
     * ---------------------------------------------------------
     */

    socket.on("close", () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }

      console.log(`[Execution WebSocket] Disconnected: ${sessionId}`);
    });

    /*
     * ---------------------------------------------------------
     * 8. Connection error
     * ---------------------------------------------------------
     */

    socket.on("error", (error) => {
      console.error(
        `[Execution WebSocket] Connection error (${sessionId}):`,
        error,
      );

      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    });
  } catch (error) {
    console.error("[Execution WebSocket] Connection handling failed:", error);

    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    sendError(
      socket,
      error?.message || "Unable to establish execution connection.",
      error?.code || "WEBSOCKET_CONNECTION_ERROR",
    );

    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1011, "Execution connection failed.");
    }
  }
}

/*
 * ============================================================
 * Session events
 * ============================================================
 */

function handleSessionEvent(socket, sessionId, event) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  if (!event || typeof event !== "object") {
    return;
  }

  switch (event.type) {
    case "stdout":
      send(socket, {
        type: "stdout",
        sessionId,
        data: event.data ?? "",
      });

      break;

    case "stderr":
      send(socket, {
        type: "stderr",
        sessionId,
        data: event.data ?? "",
      });

      break;

    case "stdin":
      /*
       * The session manager emits this when input is accepted.
       *
       * The frontend can use this to keep its terminal history
       * synchronized.
       */

      send(socket, {
        type: "stdin",
        sessionId,
        data: event.data ?? "",
      });

      break;

    case "ready":
      send(socket, {
        type: "ready",
        sessionId,
      });

      break;

    case "exit":
      send(socket, {
        type: "exit",
        sessionId,
        status: event.status,
        exitCode: event.exitCode ?? null,
        error: event.error ?? null,
      });

      break;

    case "terminated":
      send(socket, {
        type: "terminated",
        sessionId,
        status: event.status ?? "terminated",
      });

      break;

    case "error":
      sendError(
        socket,
        event.error?.message || event.message || "Execution session error.",
        event.error?.code || event.code || "SESSION_ERROR",
      );

      break;

    default:
      /*
       * Forward unknown session events without allowing them
       * to break the transport.
       */

      send(socket, {
        type: event.type || "event",
        sessionId,
        ...event,
      });
  }
}

/*
 * ============================================================
 * Client messages
 * ============================================================
 *
 * Supported messages:
 *
 * {
 *   "type": "stdin",
 *   "data": "Yash\n"
 * }
 *
 * {
 *   "type": "close-stdin"
 * }
 *
 * {
 *   "type": "terminate"
 * }
 *
 * {
 *   "type": "ping"
 * }
 */

async function handleClientMessage(socket, userId, sessionId, rawMessage) {
  let message;

  try {
    message = JSON.parse(rawMessage.toString());
  } catch {
    sendError(socket, "Invalid WebSocket message.", "INVALID_MESSAGE");

    return;
  }

  if (!message || typeof message !== "object" || Array.isArray(message)) {
    sendError(socket, "Invalid WebSocket message.", "INVALID_MESSAGE");

    return;
  }

  const type = typeof message.type === "string" ? message.type.trim() : "";

  switch (type) {
    /*
     * ---------------------------------------------------------
     * stdin
     * ---------------------------------------------------------
     */

    case "stdin": {
      if (typeof message.data !== "string") {
        sendError(socket, "stdin data must be a string.", "INVALID_STDIN");

        return;
      }

      try {
        writeSessionInput(userId, sessionId, message.data);

        /*
         * The session manager emits the actual stdin event.
         *
         * We intentionally do NOT send an acknowledgement here
         * to avoid duplicate terminal input events.
         */

      } catch (error) {
        sendError(
          socket,
          error?.message || "Unable to write execution input.",
          error?.code || "STDIN_WRITE_FAILED",
        );
      }

      break;
    }

    /*
     * ---------------------------------------------------------
     * Close stdin
     * ---------------------------------------------------------
     */

    case "close-stdin": {
      try {
        closeSessionInput(userId, sessionId);

        send(socket, {
          type: "stdin-closed",
          sessionId,
        });
      } catch (error) {
        sendError(
          socket,
          error?.message || "Unable to close execution input.",
          error?.code || "STDIN_CLOSE_FAILED",
        );
      }

      break;
    }

    /*
     * ---------------------------------------------------------
     * Terminate
     * ---------------------------------------------------------
     */

    case "terminate": {
      try {
        terminateExecutionSession(userId, sessionId);

        /*
         * The session manager will emit the actual
         * terminated event.
         */
      } catch (error) {
        sendError(
          socket,
          error?.message || "Unable to terminate execution.",
          error?.code || "TERMINATION_FAILED",
        );
      }

      break;
    }

    /*
     * ---------------------------------------------------------
     * Ping
     * ---------------------------------------------------------
     */

    case "ping":
      send(socket, {
        type: "pong",
      });

      break;

    /*
     * ---------------------------------------------------------
     * Unknown message
     * ---------------------------------------------------------
     */

    default:
      sendError(
        socket,
        `Unsupported WebSocket message type: ${type || "unknown"}`,
        "UNSUPPORTED_MESSAGE",
      );
  }
}

/*
 * ============================================================
 * WebSocket authentication
 * ============================================================
 *
 * Express middleware does not automatically run for a WebSocket
 * connection, so we explicitly reuse the existing auth
 * middleware.
 *
 * The middleware is adapted to a Promise-based request/response
 * flow.
 */

async function authenticateWebSocket(request) {
  const token = getAccessTokenFromRequest(request);

  if (!token) {
    const error = new Error("Unauthorized");
    error.code = "UNAUTHORIZED";
    throw error;
  }

  let payload;

  try {
    payload = verifyAccessToken(token);
  } catch {
    const error = new Error("Invalid or expired access token");

    error.code = "UNAUTHORIZED";

    throw error;
  }

  const user = await prisma.user.findUnique({
    where: {
      id: payload.id,
    },

    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    const error = new Error("User not found");

    error.code = "UNAUTHORIZED";

    throw error;
  }

  return user;
}

function getAccessTokenFromRequest(request) {
  /*
   * ---------------------------------------------------------
   * 1. Cookie authentication
   * ---------------------------------------------------------
   *
   * Browsers automatically send cookies during a WebSocket
   * handshake when the connection is same-origin and the
   * cookie rules allow it.
   */

  const cookieHeader = request.headers.cookie || "";

  const accessToken = parseCookie(cookieHeader, "accessToken");

  if (accessToken) {
    return accessToken;
  }

  /*
   * ---------------------------------------------------------
   * 2. Authorization header
   * ---------------------------------------------------------
   *
   * Useful for non-browser WebSocket clients such as:
   *
   * - Postman
   * - automated tests
   * - CLI clients
   * - backend clients
   */

  const authorization = request.headers.authorization;

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice(7).trim();
  }

  return null;
}

function parseCookie(cookieHeader, cookieName) {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const name = cookie.slice(0, separatorIndex).trim();

    if (name !== cookieName) {
      continue;
    }

    return decodeURIComponent(cookie.slice(separatorIndex + 1).trim());
  }

  return null;
}

/*
 * ============================================================
 * Safe JSON transport
 * ============================================================
 */

function send(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  try {
    socket.send(JSON.stringify(message));
  } catch (error) {
    console.error("[Execution WebSocket] Failed to send message:", error);
  }
}

/*
 * ============================================================
 * Structured error
 * ============================================================
 */

function sendError(socket, message, code) {
  send(socket, {
    type: "error",

    error: {
      message: String(message || "Execution WebSocket error."),

      code: String(code || "WEBSOCKET_ERROR"),
    },
  });
}
