import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";

import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";

import { chromium } from "playwright";

import { Runner } from "./runner.interface.js";

import {
  EXECUTION_LANGUAGES,
  EXECUTION_RUNTIMES,
  EXECUTION_STATUS,
  createExecutionResult,
} from "../execution.types.js";

const MAX_OUTPUT_SIZE = 1024 * 1024; // 1 MB

const DEFAULT_TIMEOUT_MS = 10000;

const SUPPORTED_EXTENSIONS = new Set([".html", ".htm", ".css", ".js", ".mjs"]);

const DEFAULT_HTML_ENTRY_POINTS = [
  "index.html",
  "src/index.html",
  "public/index.html",
];

export class BrowserRunner extends Runner {
  canRun(request) {
    return (
      request?.runtime === EXECUTION_RUNTIMES.BROWSER &&
      request?.language === EXECUTION_LANGUAGES.HTML
    );
  }

  async run(request) {
    const startTime = Date.now();

    let temporaryDirectory = null;
    let browser = null;
    let staticServer = null;

    try {
      const prepared = await prepareBrowserProject(request);

      if (!prepared.success) {
        return createExecutionResult({
          status: EXECUTION_STATUS.FAILED,
          stdout: "",
          stderr: prepared.stderr ?? "",
          exitCode: null,
          durationMs: Date.now() - startTime,
          error: prepared.error,
          runtime: EXECUTION_RUNTIMES.BROWSER,
          browserConsole: [],
        });
      }

      temporaryDirectory = prepared.temporaryDirectory;

      /*
       * ---------------------------------------------------------
       * Start local project server
       * ---------------------------------------------------------
       */

      staticServer = await startStaticServer(temporaryDirectory);

      browser = await chromium.launch({
        headless: true,
      });

      const page = await browser.newPage();

      const browserConsole = [];

      let stdout = "";
      let stderr = "";

      /*
       * ---------------------------------------------------------
       * Browser console
       * ---------------------------------------------------------
       */

      page.on("console", (message) => {
        const level = normalizeConsoleLevel(message.type());

        const text = message.text();

        const entry = {
          level,
          message: text,
        };

        browserConsole.push(entry);

        if (level === "error") {
          stderr = appendOutput(stderr, text);
        } else {
          stdout = appendOutput(stdout, text);
        }
      });

      /*
       * ---------------------------------------------------------
       * Browser page errors
       * ---------------------------------------------------------
       */

      page.on("pageerror", (error) => {
        const message = error?.message || "Unhandled browser error.";

        stderr = appendOutput(stderr, message);

        browserConsole.push({
          level: "error",
          message,
        });
      });

      /*
       * ---------------------------------------------------------
       * Browser timeout
       * ---------------------------------------------------------
       */

      const timeoutMs = request.timeoutMs || DEFAULT_TIMEOUT_MS;

      page.setDefaultTimeout(timeoutMs);

      /*
       * ---------------------------------------------------------
       * Resolve browser URL
       * ---------------------------------------------------------
       */

      const htmlRelativePath = path
        .relative(temporaryDirectory, prepared.htmlEntryPath)
        .replace(/\\/g, "/");

      const htmlUrl =
        `http://127.0.0.1:${staticServer.port}/` + encodeURI(htmlRelativePath);

      /*
       * ---------------------------------------------------------
       * Load project
       * ---------------------------------------------------------
       */

      await page.goto(htmlUrl, {
        waitUntil: "load",
        timeout: timeoutMs,
      });

      /*
       * Give browser scripts a small amount of time
       * to execute after page load.
       */

      await page.waitForTimeout(50);

      const browserResult = await collectBrowserResult(page);

      return createExecutionResult({
        status: EXECUTION_STATUS.COMPLETED,

        stdout: normalizeOutput(stdout),

        stderr: normalizeOutput(stderr),

        exitCode: 0,

        durationMs: Date.now() - startTime,

        error: null,

        runtime: EXECUTION_RUNTIMES.BROWSER,

        browserConsole,

        browserResult,
      });
    } catch (error) {
      const timedOut =
        error?.name === "TimeoutError" || error?.code === "TIMEOUT";

      if (timedOut) {
        return createExecutionResult({
          status: EXECUTION_STATUS.TIMEOUT,

          stdout: "",

          stderr: error?.message || "Browser execution timed out.",

          exitCode: null,

          durationMs: Date.now() - startTime,

          error: {
            message:
              error?.message ||
              `Browser execution timed out after ${
                request.timeoutMs || DEFAULT_TIMEOUT_MS
              }ms.`,

            code: "TIMEOUT",
          },

          runtime: EXECUTION_RUNTIMES.BROWSER,
        });
      }

      return createExecutionResult({
        status: EXECUTION_STATUS.FAILED,

        stdout: "",

        stderr: error?.message || "Browser execution failed.",

        exitCode: null,

        durationMs: Date.now() - startTime,

        error: {
          message: error?.message || "Browser execution failed.",

          code: error?.code || "BROWSER_EXECUTION_ERROR",
        },

        runtime: EXECUTION_RUNTIMES.BROWSER,
      });
    } finally {
      if (staticServer) {
        await staticServer.close().catch(() => {});
      }

      if (browser) {
        await browser.close().catch(() => {});
      }

      if (temporaryDirectory) {
        await cleanupTemporaryDirectory(temporaryDirectory);
      }
    }
  }
}

/*
 * ============================================================
 * Browser project preparation
 * ============================================================
 */

async function prepareBrowserProject(request) {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "DevLupo-browser-"),
  );

  try {
    const files = Array.isArray(request.files) ? request.files : [];

    if (!files.length) {
      await cleanupTemporaryDirectory(temporaryDirectory);

      return {
        success: false,

        error: {
          message: "No browser project files were provided.",

          code: "NO_FILES",
        },
      };
    }

    /*
     * ---------------------------------------------------------
     * Validate files
     * ---------------------------------------------------------
     */

    for (const sourceFile of files) {
      if (!isSafeProjectPath(sourceFile.path)) {
        await cleanupTemporaryDirectory(temporaryDirectory);

        return {
          success: false,

          error: {
            message: `Invalid project file path: ${sourceFile.path}`,

            code: "INVALID_FILE_PATH",
          },
        };
      }

      const extension = path.extname(sourceFile.path).toLowerCase();

      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        await cleanupTemporaryDirectory(temporaryDirectory);

        return {
          success: false,

          error: {
            message: `Unsupported browser file: ${sourceFile.path}`,

            code: "UNSUPPORTED_FILE",
          },
        };
      }
    }

    /*
     * ---------------------------------------------------------
     * Write project
     * ---------------------------------------------------------
     */

    for (const sourceFile of files) {
      const targetPath = resolveProjectPath(
        temporaryDirectory,
        sourceFile.path,
      );

      if (!targetPath) {
        await cleanupTemporaryDirectory(temporaryDirectory);

        return {
          success: false,

          error: {
            message: `Invalid project file path: ${sourceFile.path}`,

            code: "INVALID_FILE_PATH",
          },
        };
      }

      await mkdir(path.dirname(targetPath), {
        recursive: true,
      });

      await writeFile(targetPath, sourceFile.content, "utf8");
    }

    /*
     * ---------------------------------------------------------
     * Resolve HTML entry
     * ---------------------------------------------------------
     */

    const htmlEntryPath = resolveHtmlEntryPoint(files, request.entryPoint);

    if (!htmlEntryPath) {
      await cleanupTemporaryDirectory(temporaryDirectory);

      return {
        success: false,

        error: {
          message: "No HTML entry point was found.",

          code: "HTML_ENTRY_POINT_NOT_FOUND",
        },
      };
    }

    const resolvedHtmlPath = resolveProjectPath(
      temporaryDirectory,
      htmlEntryPath,
    );

    if (!resolvedHtmlPath) {
      await cleanupTemporaryDirectory(temporaryDirectory);

      return {
        success: false,

        error: {
          message: "Unable to resolve HTML entry point.",

          code: "HTML_ENTRY_POINT_RESOLUTION_FAILED",
        },
      };
    }

    return {
      success: true,

      temporaryDirectory,

      htmlEntryPath: resolvedHtmlPath,
    };
  } catch (error) {
    await cleanupTemporaryDirectory(temporaryDirectory);

    throw error;
  }
}

/*
 * ============================================================
 * HTML entry point
 * ============================================================
 */

function resolveHtmlEntryPoint(files, requestedEntryPoint) {
  const requested = requestedEntryPoint?.replace(/\\/g, "/").trim();

  if (requested) {
    const exactMatch = files.find(
      (file) => file.path.replace(/\\/g, "/") === requested,
    );

    if (
      exactMatch &&
      [".html", ".htm"].includes(path.extname(exactMatch.path).toLowerCase())
    ) {
      return exactMatch.path;
    }
  }

  const defaultEntry = DEFAULT_HTML_ENTRY_POINTS.find((candidate) =>
    files.some((file) => file.path.replace(/\\/g, "/") === candidate),
  );

  return defaultEntry ?? null;
}

/*
 * ============================================================
 * Project path helpers
 * ============================================================
 */

function isSafeProjectPath(filePath) {
  if (typeof filePath !== "string" || !filePath || filePath.includes("\0")) {
    return false;
  }

  const normalized = filePath.replace(/\\/g, "/");

  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    return false;
  }

  return normalized
    .split("/")
    .every((segment) => segment && segment !== "." && segment !== "..");
}

function resolveProjectPath(temporaryDirectory, filePath) {
  if (!isSafeProjectPath(filePath)) {
    return null;
  }

  const normalized = filePath.replace(/\\/g, "/");

  const root = path.resolve(temporaryDirectory);

  const resolved = path.resolve(root, ...normalized.split("/"));

  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

/*
 * ============================================================
 * Console helpers
 * ============================================================
 */

function normalizeConsoleLevel(level) {
  if (level === "warning") {
    return "warn";
  }

  if (["log", "info", "warn", "error"].includes(level)) {
    return level;
  }

  return "log";
}

function appendOutput(current, value) {
  const next = current + (current ? "\n" : "") + value;

  return next.length > MAX_OUTPUT_SIZE ? next.slice(0, MAX_OUTPUT_SIZE) : next;
}

/*
 * ============================================================
 * Browser result extraction
 * ============================================================
 */

async function collectBrowserResult(page) {
  return page.evaluate(() => ({
    title: document.title,

    text: document.body?.innerText || "",

    html: document.documentElement?.outerHTML || "",

    url: window.location.href,
  }));
}

/*
 * ============================================================
 * Cleanup
 * ============================================================
 */

async function cleanupTemporaryDirectory(temporaryDirectory) {
  await rm(temporaryDirectory, {
    recursive: true,
    force: true,
  }).catch(() => {});
}

/*
 * ============================================================
 * Output protection
 * ============================================================
 */

function normalizeOutput(value) {
  if (!value) {
    return "";
  }

  if (value.length <= MAX_OUTPUT_SIZE) {
    return value;
  }

  return value.slice(0, MAX_OUTPUT_SIZE) + "\n\n[Output truncated.]";
}

/*
 * ============================================================
 * Static browser project server
 * ============================================================
 */

async function startStaticServer(rootDirectory) {
  const root = path.resolve(rootDirectory);

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        response.end("Method Not Allowed");

        return;
      }

      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");

      let pathname = decodeURIComponent(requestUrl.pathname);

      if (pathname === "/") {
        pathname = "/index.html";
      }

      const relativePath = pathname.replace(/^\/+/, "");

      const filePath = resolveProjectPath(root, relativePath);

      if (!filePath) {
        response.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        response.end("Invalid file path.");

        return;
      }

      const fileContent = await readFile(filePath);

      response.writeHead(200, {
        "Content-Type": getContentType(filePath),

        "Cache-Control": "no-store",
      });

      if (request.method === "HEAD") {
        response.end();

        return;
      }

      response.end(fileContent);
    } catch (error) {
      if (error?.code === "ENOENT") {
        response.writeHead(404, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        response.end("File not found.");

        return;
      }

      console.error("[BrowserRunner] Static server error:", error);

      response.writeHead(500, {
        "Content-Type": "text/plain; charset=utf-8",
      });

      response.end("Internal browser project server error.");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);

    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);

      resolve();
    });
  });

  const address = server.address();

  const port = typeof address === "object" && address ? address.port : null;

  if (!port) {
    await closeHttpServer(server);

    throw new Error("Unable to determine browser project server port.");
  }

  return {
    port,

    close() {
      return closeHttpServer(server);
    },
  };
}

/*
 * ============================================================
 * Content types
 * ============================================================
 */

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";

    case ".css":
      return "text/css; charset=utf-8";

    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";

    default:
      return "application/octet-stream";
  }
}

/*
 * ============================================================
 * HTTP server cleanup
 * ============================================================
 */

function closeHttpServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();

      return;
    }

    server.close(() => {
      resolve();
    });
  });
}
