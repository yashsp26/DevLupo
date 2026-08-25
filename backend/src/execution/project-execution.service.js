import prisma from "../config/prisma.js";
import ApiError from "../utils/ApiError.js";

import { executeCode } from "./execution.service.js";

const SUPPORTED_LANGUAGES = new Set([
  "javascript",
  "typescript",
]);

const DEFAULT_ENTRY_POINTS = [
  "src/index.ts",
  "src/main.ts",
  "src/server.ts",
  "index.ts",
  "main.ts",
  "server.ts",

  "src/index.js",
  "src/main.js",
  "src/server.js",
  "index.js",
  "main.js",
  "server.js",
];

function normalizeProjectPath(filePath) {
  return String(filePath ?? "")
    .trim()
    .replace(/\\/g, "/");
}

function isSafeProjectPath(filePath) {
  if (
    typeof filePath !== "string" ||
    !filePath ||
    filePath.includes("\0")
  ) {
    return false;
  }

  const normalizedPath = normalizeProjectPath(filePath);

  if (
    normalizedPath.startsWith("/") ||
    normalizedPath.startsWith("\\") ||
    /^[a-zA-Z]:/.test(normalizedPath)
  ) {
    return false;
  }

  const segments = normalizedPath.split("/");

  return segments.every(
    (segment) =>
      segment &&
      segment !== "." &&
      segment !== "..",
  );
}

function selectEntryPoint(files, suppliedEntryPoint) {
  if (suppliedEntryPoint !== undefined) {
    const normalizedEntryPoint =
      normalizeProjectPath(suppliedEntryPoint);

    if (!isSafeProjectPath(normalizedEntryPoint)) {
      throw new ApiError(
        400,
        "Entry point must be a safe relative project path.",
      );
    }

    const entryFile = files.find(
      (file) =>
        file.path === normalizedEntryPoint,
    );

    if (!entryFile) {
      throw new ApiError(
        400,
        "Entry point does not exist in this project.",
      );
    }

    return entryFile.path;
  }

  const defaultEntryPoint =
    DEFAULT_ENTRY_POINTS.find((candidate) =>
      files.some(
        (file) => file.path === candidate,
      ),
    );

  if (!defaultEntryPoint) {
    throw new ApiError(
      400,
      "No default entry point was found. Provide an entryPoint.",
    );
  }

  return defaultEntryPoint;
}

function validateProjectLanguages(snippets) {
  const languages = new Set(
    snippets.map((snippet) =>
      String(snippet.language ?? "")
        .trim()
        .toLowerCase(),
    ),
  );

  if (languages.size !== 1) {
    throw new ApiError(
      400,
      "Project files must use one execution language.",
    );
  }

  const language = [...languages][0];

  if (!SUPPORTED_LANGUAGES.has(language)) {
    throw new ApiError(
      400,
      "Project execution currently supports only JavaScript and TypeScript.",
    );
  }

  return language;
}

function validateProjectFiles(snippets) {
  const paths = new Set();

  for (const snippet of snippets) {
    const filePath = normalizeProjectPath(
      snippet.filePath,
    );

    if (!isSafeProjectPath(filePath)) {
      throw new ApiError(
        400,
        "Every project file must have a valid relative file path.",
      );
    }

    if (paths.has(filePath)) {
      throw new ApiError(
        400,
        `Project contains duplicate file path: ${filePath}`,
      );
    }

    paths.add(filePath);
  }
}

function buildExecutionFiles(snippets) {
  return snippets.map((snippet) => ({
    path: normalizeProjectPath(
      snippet.filePath,
    ),

    content: snippet.code,
  }));
}

export async function executeProject(
  userId,
  projectId,
  options = {},
) {
  /*
   * ---------------------------------------------------------
   * 1. Verify project ownership
   * ---------------------------------------------------------
   */

  const project =
    await prisma.project.findFirst({
      where: {
        id: projectId,
        ownerId: userId,
      },

      select: {
        id: true,
      },
    });

  if (!project) {
    throw new ApiError(
      404,
      "Project not found.",
    );
  }

  /*
   * ---------------------------------------------------------
   * 2. Load every file belonging to the project
   * ---------------------------------------------------------
   */

  const snippets =
    await prisma.snippet.findMany({
      where: {
        projectId: project.id,
        userId,
      },

      select: {
        filePath: true,
        code: true,
        language: true,
      },

      orderBy: {
        filePath: "asc",
      },
    });

  if (!snippets.length) {
    throw new ApiError(
      400,
      "This project has no files to execute.",
    );
  }

  /*
   * ---------------------------------------------------------
   * 3. Validate project file structure
   * ---------------------------------------------------------
   */

  validateProjectFiles(snippets);

  /*
   * ---------------------------------------------------------
   * 4. Validate project language
   * ---------------------------------------------------------
   *
   * A project is intentionally scoped to ONE execution stack.
   *
   * Valid:
   *
   *   TypeScript + TypeScript
   *   JavaScript + JavaScript
   *
   * Invalid:
   *
   *   JavaScript + TypeScript
   *   JavaScript + Python
   *   React + Django
   */

  const language =
    validateProjectLanguages(
      snippets,
    );

  /*
   * ---------------------------------------------------------
   * 5. Build the in-memory project filesystem
   * ---------------------------------------------------------
   */

  const files =
    buildExecutionFiles(snippets);

  /*
   * ---------------------------------------------------------
   * 6. Select entry point
   * ---------------------------------------------------------
   */

  const entryPoint =
    selectEntryPoint(
      files,
      options.entryPoint,
    );

  /*
   * ---------------------------------------------------------
   * 7. Execute the complete project
   * ---------------------------------------------------------
   *
   * The project service does NOT know how Node, browser,
   * Python, Java, etc. execute.
   *
   * It only prepares the execution request.
   *
   * The execution service selects the appropriate runner.
   */

  return executeCode({
    language,

    runtime: "node",

    framework: "node",

    entryPoint,

    files,

    stdin: options.stdin ?? "",

    timeoutMs:
      options.timeoutMs ?? 10000,
  });
}