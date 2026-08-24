import type { SnippetLanguage } from "../features/snippets/languages";

export type ExecutionStatus = "completed" | "failed" | "timeout";
export type ExecutionRuntime = "node" | "browser";

export type ExecutionLanguage = Extract<
  SnippetLanguage,
  "javascript" | "typescript"
>;

export type ExecutionFile = {
  path: string;
  content: string;
};

export type RunCodeRequest = {
  language: ExecutionLanguage;
  framework?: string;
  entryPoint: string;
  files: ExecutionFile[];
  stdin?: string;
  timeoutMs?: number;
};

export type RunProjectRequest = {
  entryPoint?: string;
  stdin?: string;
  timeoutMs?: number;
};

export type ExecutionError = {
  message: string;
  code: string | number | null;
};

export type BrowserConsoleEntry = {
  level: "log" | "info" | "warn" | "error";
  message: string;
};

export type BrowserExecutionRequest = {
  id: number;
  code: string;
  timeoutMs: number;
};

export type BrowserExecutionCompletion = {
  status: ExecutionStatus;
  consoleEntries: BrowserConsoleEntry[];
  durationMs: number;
  error?: string;
};

export type ExecutionResult = {
  status: ExecutionStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  error: ExecutionError | null;
  runtime?: ExecutionRuntime;
  browserConsole?: BrowserConsoleEntry[];
};

export type ExecutionPanelState =
  | { status: "idle" }
  | { status: "running" }
  | { status: ExecutionStatus; result: ExecutionResult }
  | { status: "api-error"; message: string };
