import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Copy,
  Play,
  Settings,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { ExecutionPanelState } from "../../types/execution";

import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Textarea } from "../ui/Textarea";

type ExecutionOutputProps = {
  state: ExecutionPanelState;
  isRunning: boolean;
  onRun: () => void;
  runLabel?: string;
  stdin: string;
  onStdinChange: (value: string) => void;
  timeoutMs: number;
  onTimeoutChange: (timeoutMs: number) => void;
  onClear: () => void;
};

const statusDetails = {
  idle: {
    label: "Ready",
    icon: Play,
    variant: "default" as const,
  },

  completed: {
    label: "Completed",
    icon: CheckCircle2,
    variant: "success" as const,
  },

  failed: {
    label: "Failed",
    icon: XCircle,
    variant: "danger" as const,
  },

  timeout: {
    label: "Timed out",
    icon: Clock3,
    variant: "warning" as const,
  },

  running: {
    label: "Running",
    icon: Clock3,
    variant: "info" as const,
  },

  "api-error": {
    label: "Unavailable",
    icon: AlertCircle,
    variant: "danger" as const,
  },
};

function ConsoleText({ children }: { children: string }) {
  return (
    <pre className="execution-console overflow-x-auto whitespace-pre-wrap wrap-break-words rounded-xl border border-transparent bg-(--color-surface-secondary) px-4 py-3 font-mono text-xs leading-5 text-text">
      {children}
    </pre>
  );
}

function IconButton({
  label,
  title,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      className="neu-raised flex size-9 items-center justify-center rounded-xl text-muted transition hover:-translate-y-0.5 hover:shadow-(--shadow-elevation-3) hover:text-text active:translate-y-0 active:shadow-(--shadow-inset) focus:outline-none focus:ring-2 focus:ring-primary/40"
      disabled={disabled}
      onClick={onClick}
      title={title ?? label}
      type="button"
    >
      {children}
    </button>
  );
}

export function ExecutionOutput({
  state,
  isRunning,
  onRun,
  runLabel = "Run",
  stdin,
  onStdinChange,
  timeoutMs,
  onTimeoutChange,
  onClear,
}: ExecutionOutputProps) {
  const details = statusDetails[state.status];
  // const Icon = details.icon;

  const result = "result" in state ? state.result : undefined;

  const message =
    state.status === "api-error"
      ? state.message
      : result?.stderr || result?.error?.message;
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const copyOutput = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied to clipboard.");
    } catch {
      toast.error("Unable to copy to the clipboard.");
    }
  };

  return (
    <section className="execution-panel flex min-h-0 min-w-0 flex-col bg-elevated">
      {/* ------------------------------------------------------- */}
      {/* Execution header */}
      {/* ------------------------------------------------------- */}

      <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Play aria-hidden="true" className="size-5 text-text" />

          <h2 className="text-lg font-semibold text-text">Execution</h2>
        </div>

        <div className="flex items-center gap-2">
          <Button
            disabled={isRunning}
            isLoading={isRunning}
            onClick={onRun}
            type="button"
          >
            {!isRunning && <Play aria-hidden="true" className="size-4" />}

            {isRunning ? "Running..." : runLabel}
          </Button>

          <IconButton
            label="Execution settings"
            onClick={() => setIsSettingsOpen((open) => !open)}
            title="Execution settings"
          >
            <Settings className="size-4" />
          </IconButton>
        </div>
      </div>

      {/* ------------------------------------------------------- */}
      {/* Execution body */}
      {/* ------------------------------------------------------- */}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {isSettingsOpen && (
          <div className="mb-5 rounded-xl border border-border bg-app p-4">
            <label className="grid gap-2 text-sm font-medium text-text" htmlFor="execution-timeout">
              Timeout
              <select
                className="h-10 rounded-lg border border-border bg-elevated px-3 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                disabled={isRunning}
                id="execution-timeout"
                onChange={(event) => onTimeoutChange(Number(event.target.value))}
                value={timeoutMs}
              >
                <option value={1000}>1 second</option>
                <option value={5000}>5 seconds</option>
                <option value={10000}>10 seconds</option>
                <option value={30000}>30 seconds</option>
              </select>
            </label>
            <p className="mt-2 text-xs text-muted">Applied to the next run. The server supports 1–30 seconds.</p>
          </div>
        )}
        {/* --------------------------------------------------- */}
        {/* Input */}
        {/* --------------------------------------------------- */}

        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-text">Input (stdin)</p>

            <IconButton
              label="Copy stdin"
              title="Copy stdin"
              onClick={() => copyOutput(stdin)}
            >
              <Copy className="size-4" />
            </IconButton>
          </div>

          <Textarea
            className="min-h-28 font-mono text-xs leading-5"
            disabled={isRunning}
            id="execution-stdin"
            label="Input (stdin)"
            labelClassName="sr-only"
            onChange={(event) => onStdinChange(event.target.value)}
            placeholder="Enter input for your program..."
            value={stdin}
          />
          <p className="mt-2 text-xs text-muted">
            Input is sent with the request. The current execution server does not attach it to the running Node process.
          </p>
        </div>

        {/* --------------------------------------------------- */}
        {/* Status */}
        {/* --------------------------------------------------- */}

        {state.status !== "idle" && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge variant={details.variant}>{details.label}</Badge>

              {result?.durationMs != null && (
                <span className="text-xs text-muted">
                  {result.durationMs}ms
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <IconButton
                disabled={isRunning}
                label="Clear execution"
                onClick={onClear}
                title="Clear execution"
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          </div>
        )}

        {/* --------------------------------------------------- */}
        {/* Idle */}
        {/* --------------------------------------------------- */}

        {state.status === "idle" && (
          <div className="flex min-h-60 items-center justify-center rounded-lg border border-border bg-app px-6 text-center">
            <div>
              <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-elevated">
                <Play className="size-5 text-muted" />
              </div>

              <p className="text-sm font-medium text-text">
                Run your code to see the output
              </p>

              <p className="mt-1 text-xs text-muted">
                Execution results will appear here.
              </p>
            </div>
          </div>
        )}

        {/* --------------------------------------------------- */}
        {/* Running */}
        {/* --------------------------------------------------- */}

        {state.status === "running" && (
          <div className="flex min-h-60 items-center justify-center rounded-lg border border-border bg-app">
            <div className="text-center">
              <Clock3 className="mx-auto mb-3 size-6 animate-pulse text-muted" />

              <p className="text-sm font-medium text-text">
                Running your code...
              </p>

              <p className="mt-1 text-xs text-muted">
                Please wait for the execution to finish.
              </p>
            </div>
          </div>
        )}

        {/* --------------------------------------------------- */}
        {/* Error */}
        {/* --------------------------------------------------- */}

        {(state.status === "failed" ||
          state.status === "timeout" ||
          state.status === "api-error") && (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-danger">
                {state.status === "timeout" ? "Execution timed out" : "Error"}
              </p>

              {message && (
                <IconButton
                  label="Copy error"
                  title="Copy error"
                  onClick={() => copyOutput(message)}
                >
                  <Copy className="size-4" />
                </IconButton>
              )}
            </div>

            {message && <ConsoleText>{message}</ConsoleText>}
          </div>
        )}

        {/* --------------------------------------------------- */}
        {/* Completed output */}
        {/* --------------------------------------------------- */}

        {state.status === "completed" && (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-text">Output</p>

              {result?.stdout && (
                <IconButton
                  label="Copy output"
                  title="Copy output"
                  onClick={() => copyOutput(result.stdout)}
                >
                  <Copy className="size-4" />
                </IconButton>
              )}
            </div>

            <ConsoleText>{result?.stdout || "No output."}</ConsoleText>

            {result?.stderr && (
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-text">Error output</p>
                  <IconButton
                    label="Copy error output"
                    title="Copy error output"
                    onClick={() => copyOutput(result.stderr)}
                  >
                    <Copy className="size-4" />
                  </IconButton>
                </div>
                <ConsoleText>{result.stderr}</ConsoleText>
              </div>
            )}
          </div>
        )}

        {/* --------------------------------------------------- */}
        {/* Failed output */}
        {/* --------------------------------------------------- */}

        {(state.status === "failed" ||
          state.status === "timeout" ||
          state.status === "api-error") &&
          result?.stdout && (
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-text">Output</p>

                <IconButton
                  label="Copy output"
                  title="Copy output"
                  onClick={() => copyOutput(result.stdout)}
                >
                  <Copy className="size-4" />
                </IconButton>
              </div>

              <ConsoleText>{result.stdout}</ConsoleText>
            </div>
          )}

        {/* --------------------------------------------------- */}
        {/* Execution metadata */}
        {/* --------------------------------------------------- */}

        {result && (
          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4">
            <div className="rounded-lg bg-app px-4 py-3">
              <dt className="text-xs text-muted">Exit code</dt>

              <dd className="mt-1 text-sm font-semibold text-text">
                {result.exitCode ?? "-"}
              </dd>
            </div>

            <div className="rounded-lg bg-app px-4 py-3">
              <dt className="text-xs text-muted">Duration</dt>

              <dd className="mt-1 text-sm font-semibold text-text">
                {result.durationMs}ms
              </dd>
            </div>
          </dl>
        )}

        {/* --------------------------------------------------- */}
        {/* Run history */}
        {/* --------------------------------------------------- */}

        <div className="mt-5 rounded-lg border border-border bg-app px-4 py-3.5">
            <div className="flex items-center gap-3">
              <Clock3 className="size-4 text-muted" />
              <p className="text-sm font-medium text-text">Run history</p>
            </div>
            <p className="mt-2 text-xs text-muted">Run history is not available yet.</p>
        </div>
      </div>
    </section>
  );
}
