/**
 * Extract a logical file location from a Node.js stack-trace line.
 *
 * Examples:
 *
 * C:\Temp\DevLupo-run-abc\src\index.js:10:15
 * /tmp/DevLupo-run-abc/src/index.js:10:15
 * at Object.<anonymous> (...\src\index.js:10:15)
 *
 * Returns:
 *
 * at src/index.js:10:15
 */
function normalizeLocation(line) {
  const match = line.match(
    /(?:[\\/])([^()\s]+):(\d+):(\d+)/,
  );

  if (!match) {
    return null;
  }

  const [, filePath, lineNumber, columnNumber] = match;

  return `at ${filePath}:${lineNumber}:${columnNumber}`;
}

/**
 * Extract a concise error message from Node.js stderr.
 */
export function formatNodeError(
  stderr,
  fallbackMessage = "Execution failed.",
) {
  if (!stderr) {
    return fallbackMessage;
  }

  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  /*
   * Find the actual JavaScript/Node error.
   *
   * Examples:
   *
   * Error: Something went wrong
   * TypeError: Cannot read properties of undefined
   * ReferenceError: foo is not defined
   * SyntaxError: Unexpected token
   */
  const errorLine = lines.find((line) =>
    /^(Error|TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError):/.test(
      line,
    ),
  );

  /*
   * Find the first useful source location.
   */
  const locationLine = lines.find((line) =>
    /[\\/][^()\s]+:\d+:\d+/.test(line),
  );

  const location = locationLine
    ? normalizeLocation(locationLine)
    : null;

  /*
   * Best result:
   *
   * Error: Something went wrong
   * at utils.js:10:15
   */
  if (errorLine && location) {
    return `${errorLine}\n${location}`;
  }

  /*
   * If Node didn't provide a useful location,
   * still return the concise error.
   */
  if (errorLine) {
    return errorLine;
  }

  /*
   * Fallback for errors that don't match the
   * known Node error prefixes.
   */
  return fallbackMessage;
}