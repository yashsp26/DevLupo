import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

import { Runner } from "./runner.interface.js";

import {
  EXECUTION_LANGUAGES,
  EXECUTION_STATUS,
  createExecutionResult,
} from "../execution.types.js";

import { formatNodeError } from "../execution.error.js";

const MAX_OUTPUT_SIZE = 1024 * 1024; // 1 MB

const SUPPORTED_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
]);

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_INTERACTIVE_TIMEOUT_MS = 60_000;

export class NodeRunner extends Runner {
  canRun(request) {
    return (
      [EXECUTION_LANGUAGES.JAVASCRIPT, EXECUTION_LANGUAGES.TYPESCRIPT].includes(
        request?.language,
      ) &&
      (!request.runtime || request.runtime === "node") &&
      (!request.framework || request.framework === "node")
    );
  }

  /*
   * ============================================================
   * Standard / batch execution
   * ============================================================
   */

  async run(request) {
    const startTime = Date.now();

    let temporaryDirectory = null;

    try {
      const prepared = await prepareNodeExecution(request);

      if (!prepared.success) {
        return createExecutionResult({
          status: EXECUTION_STATUS.FAILED,

          stdout: prepared.stdout ?? "",

          stderr: prepared.stderr ?? "",

          exitCode: null,

          durationMs: Date.now() - startTime,

          error: prepared.error,
        });
      }

      temporaryDirectory = prepared.temporaryDirectory;

      const result = await runNodeProcess({
        executablePath: prepared.executablePath,

        cwd: temporaryDirectory,

        stdin: request.stdin ?? "",

        timeoutMs: request.timeoutMs || DEFAULT_TIMEOUT_MS,
      });

      return createExecutionResult({
        status: result.status,

        stdout: result.stdout,

        stderr: result.stderr,

        exitCode: result.exitCode,

        durationMs: Date.now() - startTime,

        error: result.error,
      });
    } catch (error) {
      const timedOut =
        error?.code === "ETIMEDOUT" || error?.code === "EXECUTION_TIMEOUT";

      if (timedOut) {
        return createExecutionResult({
          status: EXECUTION_STATUS.TIMEOUT,

          stdout: error?.stdout || "",

          stderr: error?.stderr || "",

          exitCode: null,

          durationMs: Date.now() - startTime,

          error: {
            message:
              error?.message ||
              `Execution timed out after ${
                request.timeoutMs || DEFAULT_TIMEOUT_MS
              }ms.`,

            code: "TIMEOUT",
          },
        });
      }

      const conciseError = formatNodeError(
        error?.stderr,
        error?.message || "Execution failed.",
      );

      return createExecutionResult({
        status: EXECUTION_STATUS.FAILED,

        stdout: error?.stdout || "",

        stderr: conciseError,

        exitCode: typeof error?.code === "number" ? error.code : null,

        durationMs: Date.now() - startTime,

        error: {
          message: conciseError,

          code:
            typeof error?.code === "number" ? error.code : "EXECUTION_ERROR",
        },
      });
    } finally {
      if (temporaryDirectory) {
        await cleanupTemporaryDirectory(temporaryDirectory);
      }
    }
  }

  /*
   * ============================================================
   * Interactive execution
   * ============================================================
   *
   * IMPORTANT:
   *
   * This method does NOT wait for the process to finish.
   *
   * It prepares the project, starts Node, and returns a
   * controller that can be used by the execution session layer.
   *
   * stdin remains OPEN.
   */

  async startInteractive(request, handlers = {}) {
    const prepared = await prepareNodeExecution(request);

    if (!prepared.success) {
      return {
        success: false,

        result: createExecutionResult({
          status: EXECUTION_STATUS.FAILED,

          stdout: prepared.stdout ?? "",

          stderr: prepared.stderr ?? "",

          exitCode: null,

          durationMs: 0,

          error: prepared.error,
        }),
      };
    }

    const temporaryDirectory = prepared.temporaryDirectory;

const timeoutMs =
  Number(request.timeoutMs) || DEFAULT_INTERACTIVE_TIMEOUT_MS;

    let finished = false;

    let timeoutHandle = null;

    const child = spawn(process.execPath, [prepared.executablePath], {
      cwd: temporaryDirectory,

      windowsHide: true,

      env: createExecutionEnvironment(),

      stdio: ["pipe", "pipe", "pipe"],
    });

    const cleanup = async () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      await cleanupTemporaryDirectory(temporaryDirectory);
    };

    const finish = async ({ status, exitCode = null, error = null }) => {
      if (finished) {
        return;
      }

      finished = true;

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      try {
        await handlers.onExit?.({
          status,
          exitCode,
          error,
        });
      } finally {
        await cleanup();
      }
    };

    /*
     * ---------------------------------------------------------
     * stdout
     * ---------------------------------------------------------
     */

    let stdoutSize = 0;

    child.stdout.on("data", (chunk) => {
      if (finished) {
        return;
      }

      const text = chunk.toString();

      stdoutSize += Buffer.byteLength(text, "utf8");

      if (stdoutSize > MAX_OUTPUT_SIZE) {
        try {
          child.kill();
        } catch {
          // Ignore process kill errors.
        }

        const error = {
          message: "Execution produced too much output.",

          code: "OUTPUT_LIMIT",
        };

        void finish({
          status: EXECUTION_STATUS.FAILED,

          exitCode: null,

          error,
        });

        return;
      }

      handlers.onStdout?.(text);
    });

    /*
     * ---------------------------------------------------------
     * stderr
     * ---------------------------------------------------------
     */

    let stderrSize = 0;

    child.stderr.on("data", (chunk) => {
      if (finished) {
        return;
      }

      const text = chunk.toString();

      stderrSize += Buffer.byteLength(text, "utf8");

      if (stderrSize > MAX_OUTPUT_SIZE) {
        try {
          child.kill();
        } catch {
          // Ignore process kill errors.
        }

        const error = {
          message: "Execution produced too much error output.",

          code: "OUTPUT_LIMIT",
        };

        void finish({
          status: EXECUTION_STATUS.FAILED,

          exitCode: null,

          error,
        });

        return;
      }

      handlers.onStderr?.(text);
    });

    /*
     * ---------------------------------------------------------
     * Process start error
     * ---------------------------------------------------------
     */

    child.on("error", (error) => {
      if (finished) {
        return;
      }

      const executionError = {
        message: error?.message || "Unable to start Node.js execution.",

        code: error?.code || "PROCESS_START_ERROR",
      };

      void finish({
        status: EXECUTION_STATUS.FAILED,

        exitCode: null,

        error: executionError,
      });
    });

    /*
     * ---------------------------------------------------------
     * Process exit
     * ---------------------------------------------------------
     */

    child.on("close", (exitCode) => {
      if (finished) {
        return;
      }

      if (exitCode === 0) {
        void finish({
          status: EXECUTION_STATUS.COMPLETED,

          exitCode: 0,

          error: null,
        });

        return;
      }

      /*
       * The stderr stream has already been sent to the session
       * layer. We still provide a concise error object.
       *
       * We don't have to reconstruct the entire stderr here.
       */

      void finish({
        status: EXECUTION_STATUS.FAILED,

        exitCode,

        error: {
          message: "Execution failed.",

          code: exitCode,
        },
      });
    });

    /*
     * ---------------------------------------------------------
     * Interactive timeout
     * ---------------------------------------------------------
     *
     * The process gets the full execution lifetime.
     *
     * It does NOT reset every time the user enters input.
     */

    timeoutHandle = setTimeout(() => {
      if (finished) {
        return;
      }

      try {
        child.kill();
      } catch {
        // Ignore process kill errors.
      }

      const error = {
        message: `Execution timed out after ${timeoutMs}ms.`,

        code: "TIMEOUT",
      };

      void finish({
        status: EXECUTION_STATUS.TIMEOUT,

        exitCode: null,

        error,
      });
    }, timeoutMs);

    /*
     * ---------------------------------------------------------
     * Interactive controller
     * ---------------------------------------------------------
     */

    return {
      success: true,

      process: child,

      writeStdin(input) {
        if (finished) {
          return false;
        }

        if (
          !child.stdin ||
          child.stdin.destroyed ||
          child.stdin.writableEnded
        ) {
          return false;
        }

        child.stdin.write(String(input ?? ""));

        return true;
      },

      closeStdin() {
        if (finished) {
          return;
        }

        if (
          child.stdin &&
          !child.stdin.destroyed &&
          !child.stdin.writableEnded
        ) {
          child.stdin.end();
        }
      },

      terminate() {
        if (finished) {
          return;
        }

        try {
          child.kill();
        } catch {
          // Ignore process kill errors.
        }

        const error = {
          message: "Execution terminated by the user.",

          code: "TERMINATED",
        };

        void finish({
          status: EXECUTION_STATUS.FAILED,

          exitCode: null,

          error,
        });
      },

      isFinished() {
        return finished;
      },

      cleanup,
    };
  }
}

/*
 * ============================================================
 * Node execution preparation
 * ============================================================
 *
 * This is shared by:
 *
 * run()
 * startInteractive()
 *
 * so both execution modes use exactly the same:
 *
 * - path validation
 * - project writing
 * - entry point resolution
 * - TypeScript compilation
 */

async function prepareNodeExecution(request) {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "DevLupo-run-"));

  try {
    const files = request.files || [];

    if (!files.length) {
      await cleanupTemporaryDirectory(temporaryDirectory);

      return {
        success: false,

        temporaryDirectory: null,

        error: {
          message: "No source files were provided.",

          code: "NO_FILES",
        },
      };
    }

    const isTypeScript = request.language === EXECUTION_LANGUAGES.TYPESCRIPT;

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

          temporaryDirectory: null,

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

          temporaryDirectory: null,

          error: {
            message: `Unsupported Node source file: ${sourceFile.path}`,

            code: "UNSUPPORTED_FILE",
          },
        };
      }
    }

    /*
     * ---------------------------------------------------------
     * Resolve entry point
     * ---------------------------------------------------------
     */

    const entryPoint = resolveEntryPoint(
      files,
      request.entryPoint,
      isTypeScript,
    );

    if (!entryPoint) {
      await cleanupTemporaryDirectory(temporaryDirectory);

      return {
        success: false,

        temporaryDirectory: null,

        error: {
          message: "Invalid execution entry point.",

          code: "INVALID_ENTRY_POINT",
        },
      };
    }

    /*
     * ---------------------------------------------------------
     * Write project files
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

          temporaryDirectory: null,

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
     * Resolve executable
     * ---------------------------------------------------------
     */

    let executablePath = resolveProjectPath(temporaryDirectory, entryPoint);

    if (!executablePath) {
      await cleanupTemporaryDirectory(temporaryDirectory);

      return {
        success: false,

        temporaryDirectory: null,

        error: {
          message: "Unable to resolve execution entry point.",

          code: "ENTRY_POINT_RESOLUTION_FAILED",
        },
      };
    }

    /*
     * ---------------------------------------------------------
     * TypeScript compilation
     * ---------------------------------------------------------
     */

    if (isTypeScript) {
      const compilationResult = await compileTypeScriptProject({
        temporaryDirectory,
        entryPoint,
      });

      if (!compilationResult.success) {
        await cleanupTemporaryDirectory(temporaryDirectory);

        return {
          success: false,

          temporaryDirectory: null,

          stdout: "",

          stderr: compilationResult.diagnostic,

          error: {
            message: compilationResult.message,

            code: "TYPESCRIPT_COMPILE_ERROR",
          },
        };
      }

      executablePath = compilationResult.executablePath;
    }

    return {
      success: true,

      temporaryDirectory,

      executablePath,
    };
  } catch (error) {
    await cleanupTemporaryDirectory(temporaryDirectory);

    throw error;
  }
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

  const normalizedPath = filePath.replace(/\\/g, "/");

  if (
    normalizedPath.startsWith("/") ||
    normalizedPath.startsWith("\\") ||
    /^[a-zA-Z]:/.test(normalizedPath)
  ) {
    return false;
  }

  const segments = normalizedPath.split("/");

  return segments.every(
    (segment) => segment && segment !== "." && segment !== "..",
  );
}

function resolveProjectPath(temporaryDirectory, filePath) {
  if (!isSafeProjectPath(filePath)) {
    return null;
  }

  const normalizedPath = filePath.replace(/\\/g, "/");

  const resolvedDirectory = path.resolve(temporaryDirectory);

  const resolvedPath = path.resolve(
    resolvedDirectory,
    ...normalizedPath.split("/"),
  );

  const relativePath = path.relative(resolvedDirectory, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return resolvedPath;
}

/*
 * ============================================================
 * Entry point resolution
 * ============================================================
 */

function resolveEntryPoint(files, requestedEntryPoint, isTypeScript) {
  const normalizedRequested = requestedEntryPoint?.replace(/\\/g, "/").trim();

  if (!normalizedRequested) {
    return null;
  }

  const exactMatch = files.find(
    (file) => file.path.replace(/\\/g, "/") === normalizedRequested,
  );

  if (exactMatch) {
    return exactMatch.path;
  }

  const candidates = isTypeScript
    ? [
        `${normalizedRequested}.ts`,
        `${normalizedRequested}.tsx`,
        normalizedRequested,
      ]
    : [
        `${normalizedRequested}.js`,
        `${normalizedRequested}.jsx`,
        `${normalizedRequested}.mjs`,
        `${normalizedRequested}.cjs`,
        normalizedRequested,
      ];

  const match = files.find((file) =>
    candidates.includes(file.path.replace(/\\/g, "/")),
  );

  return match?.path ?? null;
}

/*
 * ============================================================
 * TypeScript compilation
 * ============================================================
 */

async function compileTypeScriptProject({ temporaryDirectory, entryPoint }) {
  const distDirectory = path.join(temporaryDirectory, ".devlupo-dist");

  await mkdir(distDirectory, {
    recursive: true,
  });

  await writeFile(
    path.join(temporaryDirectory, "package.json"),
    JSON.stringify(
      {
        type: "module",
      },
      null,
      2,
    ),
    "utf8",
  );

  const resolvedEntryPath = resolveProjectPath(temporaryDirectory, entryPoint);

  if (!resolvedEntryPath) {
    return {
      success: false,

      message: "Invalid TypeScript entry point.",

      diagnostic: "Invalid TypeScript entry point.",

      executablePath: null,
    };
  }

  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,

    module: ts.ModuleKind.NodeNext,

    moduleResolution: ts.ModuleResolutionKind.NodeNext,

    esModuleInterop: true,

    strict: true,

    skipLibCheck: true,

    sourceMap: false,

    noEmitOnError: true,

    rootDir: temporaryDirectory,

    outDir: distDirectory,

    allowJs: false,

    jsx: ts.JsxEmit.ReactJSX,
  };

  const program = ts.createProgram([resolvedEntryPath], compilerOptions);

  const diagnostics = ts.getPreEmitDiagnostics(program);

  if (diagnostics.length > 0) {
    return {
      success: false,

      message: "TypeScript compilation failed.",

      diagnostic: formatTypeScriptDiagnostics(diagnostics),

      executablePath: null,
    };
  }

  const emitResult = program.emit();

  if (emitResult.emitSkipped) {
    return {
      success: false,

      message: "TypeScript compilation failed.",

      diagnostic:
        formatTypeScriptDiagnostics(emitResult.diagnostics) ||
        "TypeScript compiler skipped emission.",

      executablePath: null,
    };
  }

  const executableRelativePath = replaceTypeScriptExtension(entryPoint);

  const executablePath = resolveProjectPath(
    distDirectory,
    executableRelativePath,
  );

  if (!executablePath) {
    return {
      success: false,

      message: "Unable to resolve compiled entry point.",

      diagnostic: "Unable to resolve compiled entry point.",

      executablePath: null,
    };
  }

  return {
    success: true,

    message: null,

    diagnostic: null,

    executablePath,
  };
}

function replaceTypeScriptExtension(filePath) {
  return filePath.replace(/\.(tsx?|mts|cts)$/i, ".js");
}

function formatTypeScriptDiagnostics(diagnostics) {
  if (!diagnostics?.length) {
    return "";
  }

  return diagnostics.slice(0, 10).map(formatTypeScriptDiagnostic).join("\n\n");
}

function formatTypeScriptDiagnostic(diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");

  if (!diagnostic.file || diagnostic.start === undefined) {
    return message;
  }

  const position = diagnostic.file.getLineAndCharacterOfPosition(
    diagnostic.start,
  );

  const normalizedFile = diagnostic.file.fileName.replace(/\\/g, "/");

  const marker = normalizedFile.lastIndexOf("/");

  const fileName =
    marker >= 0 ? normalizedFile.slice(marker + 1) : normalizedFile;

  return `${fileName}:${position.line + 1}:${position.character + 1}\n${message}`;
}

/*
 * ============================================================
 * Standard Node process execution
 * ============================================================
 */

function runNodeProcess({ executablePath, cwd, stdin, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [executablePath], {
      cwd,

      windowsHide: true,

      env: createExecutionEnvironment(),

      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";

    let stderr = "";

    let finished = false;

    const finish = (result) => {
      if (finished) {
        return;
      }

      finished = true;

      clearTimeout(timeoutHandle);

      resolve(result);
    };

    const timeoutHandle = setTimeout(() => {
      if (finished) {
        return;
      }

      child.kill();

      finish({
        status: EXECUTION_STATUS.TIMEOUT,

        stdout: normalizeOutput(stdout),

        stderr: normalizeOutput(stderr),

        exitCode: null,

        error: {
          message: `Execution timed out after ${timeoutMs}ms.`,

          code: "TIMEOUT",
        },
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();

      if (stdout.length > MAX_OUTPUT_SIZE) {
        child.kill();

        finish({
          status: EXECUTION_STATUS.FAILED,

          stdout: normalizeOutput(stdout),

          stderr: normalizeOutput(stderr),

          exitCode: null,

          error: {
            message: "Execution produced too much output.",

            code: "OUTPUT_LIMIT",
          },
        });
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();

      if (stderr.length > MAX_OUTPUT_SIZE) {
        child.kill();

        finish({
          status: EXECUTION_STATUS.FAILED,

          stdout: normalizeOutput(stdout),

          stderr: normalizeOutput(stderr),

          exitCode: null,

          error: {
            message: "Execution produced too much error output.",

            code: "OUTPUT_LIMIT",
          },
        });
      }
    });

    child.on("error", (error) => {
      finish({
        status: EXECUTION_STATUS.FAILED,

        stdout: normalizeOutput(stdout),

        stderr: normalizeOutput(stderr),

        exitCode: null,

        error: {
          message: error?.message || "Unable to start Node.js execution.",

          code: error?.code || "PROCESS_START_ERROR",
        },
      });
    });

    child.on("close", (exitCode) => {
      if (finished) {
        return;
      }

      const normalizedStdout = normalizeOutput(stdout);

      const normalizedStderr = normalizeOutput(stderr);

      if (exitCode === 0) {
        finish({
          status: EXECUTION_STATUS.COMPLETED,

          stdout: normalizedStdout,

          stderr: normalizedStderr,

          exitCode: 0,

          error: null,
        });

        return;
      }

      const conciseError = formatNodeError(
        normalizedStderr,
        "Execution failed.",
      );

      finish({
        status: EXECUTION_STATUS.FAILED,

        stdout: normalizedStdout,

        stderr: conciseError,

        exitCode,

        error: {
          message: conciseError,

          code: exitCode,
        },
      });
    });

    child.stdin.write(stdin ?? "");

    child.stdin.end();
  });
}

/*
 * ============================================================
 * Execution environment
 * ============================================================
 */

function createExecutionEnvironment() {
  return {
    NODE_ENV: "development",

    PATH: process.env.PATH || "",

    NODE_PATH: process.env.NODE_PATH || "",

    TEMP: process.env.TEMP || "",

    TMP: process.env.TMP || "",

    SystemRoot: process.env.SystemRoot || "",
  };
}

/*
 * ============================================================
 * Temporary directory cleanup
 * ============================================================
 */

async function cleanupTemporaryDirectory(temporaryDirectory) {
  if (!temporaryDirectory) {
    return;
  }

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

