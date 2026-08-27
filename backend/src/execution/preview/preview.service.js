import crypto from "node:crypto";
import http from "node:http";

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { tmpdir } from "node:os";

import path from "node:path";

import ts from "typescript";

import {
  MAX_PREVIEWS,
  PREVIEW_STATUS,
  PREVIEW_TTL_MS,
} from "./preview.types.js";

const SUPPORTED_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".ts",
  ".json",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
]);

const TYPESCRIPT_EXTENSIONS = new Set([".ts"]);

const DEFAULT_HTML_ENTRY_POINTS = [
  "index.html",
  "src/index.html",
  "public/index.html",
];

const PREVIEW_ID_BYTES = 24;

const previews = new Map();

/*
 * ============================================================
 * Create preview
 * ============================================================
 */

export async function createPreview({ userId, request }) {
  if (!userId) {
    const error = new Error("User ID is required.");

    error.code = "USER_ID_REQUIRED";

    throw error;
  }

  if (!request) {
    const error = new Error("Preview request is required.");

    error.code = "PREVIEW_REQUEST_REQUIRED";

    throw error;
  }

  if (previews.size >= MAX_PREVIEWS) {
    const error = new Error(
      "The preview server is currently busy. Please try again later.",
    );

    error.code = "PREVIEW_CAPACITY_REACHED";

    throw error;
  }

  const normalizedRequest = normalizePreviewRequest(request);

  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "DevLupo-preview-"),
  );

  try {
    validateFiles(normalizedRequest.files);

    const entryPoint = resolveHtmlEntryPoint(
      normalizedRequest.files,
      normalizedRequest.entryPoint,
    );

    if (!entryPoint) {
      const error = new Error("No HTML entry point was found.");

      error.code = "HTML_ENTRY_POINT_NOT_FOUND";

      throw error;
    }

    /*
     * ---------------------------------------------------------
     * Write project
     * ---------------------------------------------------------
     *
     * TypeScript files are transpiled before they are written
     * into the browser preview directory.
     *
     * Existing HTML/CSS/JS files remain unchanged.
     */

    await writeProjectFiles(temporaryDirectory, normalizedRequest.files);

    /*
     * ---------------------------------------------------------
     * Resolve generated HTML
     * ---------------------------------------------------------
     *
     * HTML may reference .ts files directly:
     *
     * <script type="module" src="./app.ts"></script>
     *
     * The browser cannot execute TypeScript, so those references
     * are rewritten to the generated .js files.
     */

    await transformHtmlTypeScriptReferences(temporaryDirectory, entryPoint);

    const resolvedEntryPoint = resolveProjectPath(
      temporaryDirectory,
      entryPoint,
    );

    if (!resolvedEntryPoint) {
      const error = new Error("Unable to resolve preview entry point.");

      error.code = "INVALID_ENTRY_POINT";

      throw error;
    }

    const server = await startPreviewServer(temporaryDirectory);

    const previewId = crypto.randomBytes(PREVIEW_ID_BYTES).toString("hex");

    const preview = {
      id: previewId,

      userId: String(userId),

      status: PREVIEW_STATUS.RUNNING,

      createdAt: Date.now(),

      expiresAt: Date.now() + PREVIEW_TTL_MS,

      temporaryDirectory,

      entryPoint,

      server,

      timer: null,
    };

    previews.set(previewId, preview);

    preview.timer = setTimeout(() => {
      void stopPreview(previewId, PREVIEW_STATUS.EXPIRED);
    }, PREVIEW_TTL_MS);

    preview.timer.unref?.();

    return getPreviewInfo(preview);
  } catch (error) {
    await cleanupTemporaryDirectory(temporaryDirectory);

    throw error;
  }
}

/*
 * ============================================================
 * Get preview
 * ============================================================
 */

export function getPreview(userId, previewId) {
  const preview = getOwnedPreview(userId, previewId);

  return getPreviewInfo(preview);
}

/*
 * ============================================================
 * Stop preview
 * ============================================================
 */

export async function stopPreview(
  previewId,
  finalStatus = PREVIEW_STATUS.STOPPED,
) {
  const preview = previews.get(previewId);

  if (!preview) {
    return false;
  }

  if (preview.timer) {
    clearTimeout(preview.timer);

    preview.timer = null;
  }

  preview.status = PREVIEW_STATUS.STOPPING;

  try {
    await preview.server.close();
  } catch {
    // Ignore server cleanup errors.
  }

  await cleanupTemporaryDirectory(preview.temporaryDirectory);

  preview.status = finalStatus;

  previews.delete(previewId);

  return true;
}

/*
 * ============================================================
 * Preview count
 * ============================================================
 */

export function getActivePreviewCount() {
  return previews.size;
}

/*
 * ============================================================
 * Application shutdown
 * ============================================================
 */

export async function cleanupPreviews() {
  const activePreviews = [...previews.keys()];

  await Promise.all(
    activePreviews.map((previewId) => stopPreview(previewId).catch(() => {})),
  );
}

/*
 * ============================================================
 * Ownership
 * ============================================================
 */

function getOwnedPreview(userId, previewId) {
  const preview = previews.get(previewId);

  if (!preview || preview.userId !== String(userId)) {
    const error = new Error("Preview not found.");

    error.code = "PREVIEW_NOT_FOUND";

    throw error;
  }

  return preview;
}

/*
 * ============================================================
 * Preview information
 * ============================================================
 */

function getPreviewInfo(preview) {
  const baseUrl =
    process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;

  return {
    id: preview.id,

    status: preview.status,

    entryPoint: preview.entryPoint,

    createdAt: preview.createdAt,

    expiresAt: preview.expiresAt,

    url: `${baseUrl}/api/v1/execution/preview-content/${preview.id}/${preview.entryPoint}`,
  };
}

/*
 * ============================================================
 * Request normalization
 * ============================================================
 */

function normalizePreviewRequest(request) {
  return {
    entryPoint: String(request.entryPoint ?? "index.html").trim(),

    files: Array.isArray(request.files)
      ? request.files.map((file) => ({
          path: String(file?.path ?? "").trim(),

          content: String(file?.content ?? ""),
        }))
      : [],
  };
}

/*
 * ============================================================
 * File validation
 * ============================================================
 */

function validateFiles(files) {
  if (!files.length) {
    const error = new Error("No browser project files were provided.");

    error.code = "NO_FILES";

    throw error;
  }

  for (const file of files) {
    if (!isSafeProjectPath(file.path)) {
      const error = new Error(`Invalid project file path: ${file.path}`);

      error.code = "INVALID_FILE_PATH";

      throw error;
    }

    const extension = path.extname(file.path).toLowerCase();

    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      const error = new Error(`Unsupported preview file: ${file.path}`);

      error.code = "UNSUPPORTED_FILE";

      throw error;
    }
  }
}

/*
 * ============================================================
 * Write project
 * ============================================================
 */

async function writeProjectFiles(directory, files) {
  for (const file of files) {
    const targetPath = resolveProjectPath(directory, file.path);

    if (!targetPath) {
      const error = new Error(`Invalid project file path: ${file.path}`);

      error.code = "INVALID_FILE_PATH";

      throw error;
    }

    await mkdir(path.dirname(targetPath), {
      recursive: true,
    });

    const extension = path.extname(file.path).toLowerCase();

    /*
     * ---------------------------------------------------------
     * TypeScript
     * ---------------------------------------------------------
     *
     * Keep the original .ts file for project integrity.
     *
     * Generate a sibling .js file that the browser can execute.
     */

    if (TYPESCRIPT_EXTENSIONS.has(extension)) {
      await writeTypeScriptFile(directory, file);

      continue;
    }

    /*
     * ---------------------------------------------------------
     * Existing browser files
     * ---------------------------------------------------------
     *
     * HTML/CSS/JS/etc remain exactly as supplied.
     */

    await writeFile(targetPath, file.content, "utf8");
  }
}

/*
 * ============================================================
 * TypeScript transpilation
 * ============================================================
 */

async function writeTypeScriptFile(directory, file) {
  const sourcePath = file.path;

  const sourceExtension = path.extname(sourcePath).toLowerCase();

  if (!TYPESCRIPT_EXTENSIONS.has(sourceExtension)) {
    return;
  }

  const outputPath = replaceExtension(sourcePath, ".js");

  /*
   * Prevent a TypeScript file from silently overwriting
   * a user-provided JavaScript file.
   */

  const existingJsPath = resolveProjectPath(directory, outputPath);

  if (!existingJsPath) {
    const error = new Error(`Invalid TypeScript output path: ${outputPath}`);

    error.code = "INVALID_TYPESCRIPT_OUTPUT_PATH";

    throw error;
  }

  try {
    await readFile(existingJsPath);
    const error = new Error(
      `TypeScript output conflicts with an existing JavaScript file: ${outputPath}`,
    );

    error.code = "TYPESCRIPT_OUTPUT_CONFLICT";

    throw error;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  let transpiled;

  try {
    transpiled = ts.transpileModule(file.content, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,

        module: ts.ModuleKind.ESNext,

        moduleResolution: ts.ModuleResolutionKind.Bundler,

        sourceMap: false,

        inlineSourceMap: false,

        removeComments: false,

        jsx: ts.JsxEmit.Preserve,

        esModuleInterop: true,

        allowSyntheticDefaultImports: true,

        strict: false,
      },

      fileName: sourcePath,

      reportDiagnostics: true,
    });
  } catch (error) {
    const wrappedError = new Error(
      `Failed to transpile TypeScript file "${sourcePath}": ${
        error?.message || "Unknown TypeScript error."
      }`,
    );

    wrappedError.code = "TYPESCRIPT_TRANSPILE_ERROR";

    throw wrappedError;
  }

  const diagnostics = transpiled.diagnostics ?? [];

  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );

  /*
   * transpileModule normally reports syntax-level
   * diagnostics. Type errors are intentionally not performed
   * here because browser preview should remain fast.
   */

  if (errors.length) {
    const message = formatTypeScriptDiagnostics(errors);

    const error = new Error(
      `TypeScript compilation failed for "${sourcePath}".\n${message}`,
    );

    error.code = "TYPESCRIPT_COMPILE_ERROR";

    throw error;
  }

  /*
   * TypeScript preserves module specifiers.
   *
   * Browser modules cannot resolve:
   *
   * ./message.ts
   *
   * so convert them to:
   *
   * ./message.js
   */

  const browserJavaScript = rewriteTypeScriptModuleSpecifiers(
    transpiled.outputText,
  );

  const targetPath = resolveProjectPath(directory, outputPath);

  await mkdir(path.dirname(targetPath), {
    recursive: true,
  });

  await writeFile(targetPath, browserJavaScript, "utf8");
}

/*
 * ============================================================
 * TypeScript diagnostics
 * ============================================================
 */

function formatTypeScriptDiagnostics(diagnostics) {
  return diagnostics
    .map((diagnostic) => {
      return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    })
    .join("\n");
}

/*
 * ============================================================
 * TypeScript module references
 * ============================================================
 */

function rewriteTypeScriptModuleSpecifiers(source) {
  /*
   * Handles:
   *
   * import x from "./file.ts"
   * import "./file.ts"
   * export x from "./file.ts"
   * export * from "./file.ts"
   *
   * and dynamic imports:
   *
   * import("./file.ts")
   */

  return source.replace(
    /((?:from\s*|import\s*)["'])([^"']+)(["'])/g,
    (fullMatch, prefix, specifier, suffix) => {
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
        return fullMatch;
      }

      const rewritten = rewriteTypeScriptSpecifier(specifier);

      return `${prefix}${rewritten}${suffix}`;
    },
  );
}

function rewriteTypeScriptSpecifier(specifier) {
  const queryIndex = specifier.indexOf("?");

  const hashIndex = specifier.indexOf("#");

  const cutIndex = [queryIndex, hashIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  const pathname =
    cutIndex === undefined ? specifier : specifier.slice(0, cutIndex);

  const suffix = cutIndex === undefined ? "" : specifier.slice(cutIndex);

  if (pathname.endsWith(".tsx")) {
    return `${pathname.slice(0, -".tsx".length)}.js${suffix}`;
  }

  if (pathname.endsWith(".ts")) {
    return `${pathname.slice(0, -".ts".length)}.js${suffix}`;
  }

  return specifier;
}

/*
 * ============================================================
 * HTML TypeScript references
 * ============================================================
 */

async function transformHtmlTypeScriptReferences(directory, entryPoint) {
  const htmlPath = resolveProjectPath(directory, entryPoint);

  if (!htmlPath) {
    const error = new Error("Unable to resolve HTML entry point.");

    error.code = "HTML_ENTRY_POINT_RESOLUTION_FAILED";

    throw error;
  }

  let html;

  try {
    html = await readFile(htmlPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      const wrappedError = new Error(
        `HTML entry point not found: ${entryPoint}`,
      );

      wrappedError.code = "HTML_ENTRY_POINT_NOT_FOUND";

      throw wrappedError;
    }

    throw error;
  }

  /*
   * Only rewrite script src references.
   *
   * Existing HTML/CSS/JS behavior remains untouched.
   */

  const transformedHtml = html.replace(
    /(<script\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
    (fullMatch, prefix, src, suffix) => {
      const rewritten = rewriteTypeScriptSpecifier(src);

      if (rewritten === src) {
        return fullMatch;
      }

      return `${prefix}${rewritten}${suffix}`;
    },
  );

  if (transformedHtml !== html) {
    await writeFile(htmlPath, transformedHtml, "utf8");
  }
}

/*
 * ============================================================
 * Extension helper
 * ============================================================
 */

function replaceExtension(filePath, extension) {
  const currentExtension = path.extname(filePath);

  return `${filePath.slice(0, -currentExtension.length)}${extension}`;
}

/*
 * ============================================================
 * Entry point
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

  return (
    DEFAULT_HTML_ENTRY_POINTS.find((candidate) =>
      files.some((file) => file.path.replace(/\\/g, "/") === candidate),
    ) ?? null
  );
}

/*
 * ============================================================
 * Path security
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

function resolveProjectPath(directory, filePath) {
  if (!isSafeProjectPath(filePath)) {
    return null;
  }

  const normalized = filePath.replace(/\\/g, "/");

  const root = path.resolve(directory);

  const resolved = path.resolve(root, ...normalized.split("/"));

  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

/*
 * ============================================================
 * Preview HTTP server
 * ============================================================
 */

async function startPreviewServer(rootDirectory) {
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
        sendText(response, 400, "Invalid file path.");

        return;
      }

      const fileContent = await readFile(filePath);

      response.writeHead(200, {
        "Content-Type": getContentType(filePath),

        "Cache-Control": "no-store",

        "X-Content-Type-Options": "nosniff",
      });

      if (request.method === "HEAD") {
        response.end();

        return;
      }

      response.end(fileContent);
    } catch (error) {
      if (error?.code === "ENOENT") {
        sendText(response, 404, "File not found.");

        return;
      }

      console.error("[Preview] Server error:", error);

      sendText(response, 500, "Internal preview server error.");
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

    throw new Error("Unable to determine preview project server port.");
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

    case ".json":
      return "application/json; charset=utf-8";

    case ".svg":
      return "image/svg+xml";

    case ".png":
      return "image/png";

    case ".jpg":
    case ".jpeg":
      return "image/jpeg";

    case ".gif":
      return "image/gif";

    case ".webp":
      return "image/webp";

    case ".ico":
      return "image/x-icon";

    default:
      return "application/octet-stream";
  }
}

/*
 * ============================================================
 * HTTP helpers
 * ============================================================
 */

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
  });

  response.end(message);
}

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

/*
 * ============================================================
 * Cleanup
 * ============================================================
 */

async function cleanupTemporaryDirectory(directory) {
  if (!directory) {
    return;
  }

  await rm(directory, {
    recursive: true,
    force: true,
  }).catch(() => {});
}

/*
 * ============================================================
 * Public preview serving
 * ============================================================
 */

export async function servePreviewRequest(previewId, requestPath, response) {
  const preview = previews.get(previewId);

  if (!preview) {
    const error = new Error("Preview not found.");

    error.code = "PREVIEW_NOT_FOUND";

    throw error;
  }

  if (preview.status !== PREVIEW_STATUS.RUNNING) {
    const error = new Error("Preview is no longer running.");

    error.code = "PREVIEW_NOT_RUNNING";

    throw error;
  }

  const pathname = normalizePreviewPath(requestPath);

  const filePath = resolveProjectPath(preview.temporaryDirectory, pathname);

  if (!filePath) {
    const error = new Error("Invalid preview file path.");

    error.code = "INVALID_PREVIEW_PATH";

    throw error;
  }

  try {
    const fileContent = await readFile(filePath);

    response.status(200);

    response.setHeader("Access-Control-Allow-Origin", "*");

    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");

    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    response.setHeader("Content-Type", getContentType(filePath));

    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

    /*
     * The preview is untrusted user code.
     *
     * Give it a unique/opaque browser origin so it cannot
     * access the DevLupo application origin.
     */

    response.setHeader(
      "Content-Security-Policy",
      "sandbox allow-scripts allow-forms allow-modals",
    );

    response.setHeader("X-Content-Type-Options", "nosniff");

    response.send(fileContent);
  } catch (error) {
    if (error?.code === "ENOENT") {
      response.status(404).send("Preview file not found.");

      return;
    }

    throw error;
  }
}

function normalizePreviewPath(requestPath) {
  let pathname = String(requestPath ?? "").trim();

  pathname = pathname.replace(/\\/g, "/");

  pathname = pathname.replace(/^\/+/, "");

  if (!pathname) {
    return "index.html";
  }

  return pathname;
}
