export const EXECUTION_LANGUAGES = Object.freeze({
  JAVASCRIPT: "javascript",
  TYPESCRIPT: "typescript",
  HTML: "html",
  CSS: "css",
});

export const EXECUTION_RUNTIMES = Object.freeze({
  NODE: "node",
  BROWSER: "browser",
});

export const EXECUTION_STATUS = Object.freeze({
  COMPLETED: "completed",
  FAILED: "failed",
  TIMEOUT: "timeout",
  TERMINATED: "terminated",
});

const SUPPORTED_LANGUAGES = new Set(Object.values(EXECUTION_LANGUAGES));

const SUPPORTED_RUNTIMES = new Set(Object.values(EXECUTION_RUNTIMES));

const DEFAULT_TIMEOUT_MS = 10000;

export function createExecutionRequest(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Execution request is required.");
  }

  const language = String(input.language ?? "")
    .trim()
    .toLowerCase();

  const runtime = String(
    input.runtime ?? input.framework ?? EXECUTION_RUNTIMES.NODE,
  )
    .trim()
    .toLowerCase();

  const entryPoint = String(input.entryPoint ?? "index.js").trim();

  const files = Array.isArray(input.files)
    ? input.files.map((file) => ({
        path: String(file?.path ?? "").trim(),

        content: String(file?.content ?? ""),
      }))
    : [];

  const stdin = String(input.stdin ?? "");

  const timeoutMs = Number(input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  return {
    language,
    runtime,

    framework: input.framework
      ? String(input.framework).trim().toLowerCase()
      : undefined,

    entryPoint,

    files,

    stdin,

    timeoutMs,
  };
}

export function isSupportedLanguage(language) {
  return SUPPORTED_LANGUAGES.has(
    String(language ?? "")
      .trim()
      .toLowerCase(),
  );
}

export function isSupportedRuntime(runtime) {
  return SUPPORTED_RUNTIMES.has(
    String(runtime ?? "")
      .trim()
      .toLowerCase(),
  );
}

export function getSupportedLanguages() {
  return [...SUPPORTED_LANGUAGES];
}

export function getSupportedRuntimes() {
  return [...SUPPORTED_RUNTIMES];
}

export function validateExecutionRequest(request) {
  if (!isSupportedLanguage(request.language)) {
    throw new Error(`Unsupported execution language: ${request.language}`);
  }

  if (!isSupportedRuntime(request.runtime)) {
    throw new Error(`Unsupported execution runtime: ${request.runtime}`);
  }

  if (!request.entryPoint) {
    throw new Error("Execution entry point is required.");
  }

  if (!Array.isArray(request.files) || request.files.length === 0) {
    throw new Error("At least one execution file is required.");
  }

  const paths = new Set();

  for (const file of request.files) {
    if (!file.path) {
      throw new Error("Every execution file must have a path.");
    }

    if (paths.has(file.path)) {
      throw new Error(`Duplicate execution file path: ${file.path}`);
    }

    paths.add(file.path);
  }

  if (!paths.has(request.entryPoint)) {
    /*
     * The NodeRunner itself supports resolving an extensionless
     * entry point such as "src/index".
     *
     * Therefore don't reject it here if the exact path doesn't
     * exist. The runner will resolve it.
     */

    const normalizedEntry = request.entryPoint.replace(/\\/g, "/");

    const entryWithoutExtension = normalizedEntry.replace(
      /\.(jsx?|tsx?|mjs|cjs)$/i,
      "",
    );

    const possibleMatch = [...paths].some((filePath) => {
      const normalized = filePath.replace(/\\/g, "/");

      const withoutExtension = normalized.replace(
        /\.(jsx?|tsx?|mjs|cjs)$/i,
        "",
      );

      return withoutExtension === entryWithoutExtension;
    });

    if (!possibleMatch) {
      throw new Error(
        `Entry point does not exist in execution files: ${request.entryPoint}`,
      );
    }
  }

  if (
    !Number.isInteger(request.timeoutMs) ||
    request.timeoutMs < 1000 ||
    request.timeoutMs > 30000
  ) {
    throw new Error(
      "Execution timeout must be between 1000 and 30000 milliseconds.",
    );
  }

  return request;
}

export function createExecutionResult({
  status,
  stdout = "",
  stderr = "",
  exitCode = null,
  durationMs = 0,
  error = null,
  runtime = null,
  browserConsole = [],
  browserResult = null,
}) {
  return {
    status,
    stdout,
    stderr,
    exitCode,
    durationMs,
    error,
    ...(runtime ? { runtime } : {}),
    ...(browserConsole.length ? { browserConsole } : {}),
        browserResult,
  };
}
