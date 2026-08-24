import { useEffect, useRef, useState } from "react";

import type {
  BrowserConsoleEntry,
  BrowserExecutionCompletion,
  BrowserExecutionRequest,
} from "../../types/execution";

const channel = "devlupo-browser-execution";

const serialize = (value: string) =>
  JSON.stringify(value).replace(/</g, "\\u003c");

const makePromptsAwaitable = (code: string) =>
  code.replace(/\bprompt\s*\(/g, "await __devlupoPrompt(");

const createDocument = (request: BrowserExecutionRequest) => `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>DevLupo browser preview</title></head>
  <body>
    <script>
      (() => {
        const channel = ${serialize(channel)};
        const runId = ${request.id};
        const code = ${serialize(request.code)};
        const send = (type, payload = {}) => window.parent.postMessage(
          { channel, runId, type, ...payload },
          "*",
        );
        const format = (value) => {
          if (typeof value === "string") return value;
          try { return JSON.stringify(value); } catch { return String(value); }
        };
        const nativeSetTimeout = window.setTimeout.bind(window);
        const nativeClearTimeout = window.clearTimeout.bind(window);
        const nativeSetInterval = window.setInterval.bind(window);
        const nativeClearInterval = window.clearInterval.bind(window);
        const timeouts = new Set();
        const intervals = new Set();
        let nextPromptId = 0;
        let initialized = false;
        let finished = false;
        const requestInput = (message = "", defaultValue = "") => new Promise((resolve) => {
          const promptId = ++nextPromptId;
          const receiveInput = (event) => {
            if (event.source !== window.parent || !event.data || typeof event.data !== "object") return;
            const data = event.data;
            if (data.channel !== channel || data.runId !== runId || data.type !== "input-response" || data.promptId !== promptId) return;
            window.removeEventListener("message", receiveInput);
            resolve(data.value == null ? null : String(data.value));
          };
          window.addEventListener("message", receiveInput);
          send("input-request", { promptId, message: String(message), defaultValue: String(defaultValue) });
        });
        const completeIfIdle = () => {
          if (!initialized || finished || timeouts.size || intervals.size) return;
          nativeSetTimeout(() => {
            if (!finished && !timeouts.size && !intervals.size) {
              finished = true;
              send("complete", { html: document.documentElement.outerHTML });
            }
          }, 0);
        };

        window.setTimeout = (callback, delay, ...args) => {
          let id;
          id = nativeSetTimeout(() => {
            try { callback(...args); } finally { timeouts.delete(id); completeIfIdle(); }
          }, delay);
          timeouts.add(id);
          return id;
        };
        window.clearTimeout = (id) => {
          timeouts.delete(id);
          nativeClearTimeout(id);
          completeIfIdle();
        };
        window.setInterval = (callback, delay, ...args) => {
          const id = nativeSetInterval(() => callback(...args), delay);
          intervals.add(id);
          return id;
        };
        window.clearInterval = (id) => {
          intervals.delete(id);
          nativeClearInterval(id);
          completeIfIdle();
        };

        ["log", "info", "warn", "error"].forEach((level) => {
          const original = console[level].bind(console);
          console[level] = (...values) => {
            original(...values);
            send("console", { level, message: values.map(format).join(" ") });
          };
        });

        window.addEventListener("error", (event) => {
          send("error", { message: event.error?.message || event.message || "Browser execution failed." });
        });
        window.addEventListener("unhandledrejection", (event) => {
          send("error", { message: event.reason?.message || String(event.reason) });
        });

        try {
          const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
          const executableCode = ${serialize(makePromptsAwaitable(request.code))};
          AsyncFunction("__devlupoPrompt", executableCode)(requestInput)
            .then(() => {
              initialized = true;
              completeIfIdle();
            })
            .catch((error) => {
              send("error", { message: error instanceof Error ? error.message : String(error) });
            });
        } catch (error) {
          send("error", { message: error instanceof Error ? error.message : String(error) });
        }
      })();
    </script>
  </body>
</html>`;

type BrowserPreviewProps = {
  request?: BrowserExecutionRequest;
  onComplete: (completion: BrowserExecutionCompletion) => void;
};

type BrowserPrompt = {
  defaultValue: string;
  message: string;
  promptId: number;
};

export function BrowserPreview({ request, onComplete }: BrowserPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const entriesRef = useRef<BrowserConsoleEntry[]>([]);
  const completedRef = useRef(false);
  const startedAtRef = useRef(0);
  const [entries, setEntries] = useState<BrowserConsoleEntry[]>([]);
  const [pendingPrompt, setPendingPrompt] = useState<BrowserPrompt>();
  const [promptValue, setPromptValue] = useState("");
  const [srcDoc, setSrcDoc] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    entriesRef.current = [];
    setEntries([]);
    setPendingPrompt(undefined);
    setPromptValue("");
    completedRef.current = false;
    startedAtRef.current = Date.now();
    setIsExecuting(Boolean(request));
    setSrcDoc(request ? createDocument(request) : "");

    if (!request) return;

    const finish = (
      status: BrowserExecutionCompletion["status"],
      error?: string,
      previewHtml?: string,
    ) => {
      if (completedRef.current) return;
      completedRef.current = true;
      setIsExecuting(false);
      setPendingPrompt(undefined);
      setSrcDoc(previewHtml ?? "");
      onComplete({
        consoleEntries: entriesRef.current,
        durationMs: Date.now() - startedAtRef.current,
        error,
        status,
      });
    };

    const timeout = window.setTimeout(() => {
      if (completedRef.current) return;
      finish("timeout", `Browser execution timed out after ${request.timeoutMs}ms.`);
    }, request.timeoutMs);

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow || !event.data || typeof event.data !== "object") {
        return;
      }

      const data = event.data as {
        channel?: string;
        level?: BrowserConsoleEntry["level"];
        message?: string;
        html?: string;
        defaultValue?: string;
        promptId?: number;
        runId?: number;
        type?: "complete" | "console" | "error" | "input-request";
      };

      if (data.channel !== channel || data.runId !== request.id) return;

      if (data.type === "console" && data.level && typeof data.message === "string") {
        const entry = { level: data.level, message: data.message };
        entriesRef.current = [...entriesRef.current, entry];
        setEntries(entriesRef.current);
      } else if (data.type === "error") {
        finish("failed", data.message || "Browser execution failed.");
      } else if (data.type === "complete") {
        finish("completed", undefined, data.html);
      } else if (data.type === "input-request" && typeof data.promptId === "number") {
        setPromptValue(data.defaultValue ?? "");
        setPendingPrompt({
          defaultValue: data.defaultValue ?? "",
          message: data.message ?? "Enter a value",
          promptId: data.promptId,
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
    };
  }, [onComplete, request]);

  const respondToPrompt = (value: string | null) => {
    if (!request || !pendingPrompt || !iframeRef.current?.contentWindow) return;

    iframeRef.current.contentWindow.postMessage(
      {
        channel,
        promptId: pendingPrompt.promptId,
        runId: request.id,
        type: "input-response",
        value,
      },
      "*",
    );
    setPendingPrompt(undefined);
  };

  return (
    <div className="mb-5 space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium text-text">Browser preview</p>
        {pendingPrompt && (
          <div
            className="mb-3 rounded-xl border border-primary/30 bg-app p-3"
          >
            <label className="grid gap-2 text-sm font-medium text-text" htmlFor="browser-prompt-input">
              {pendingPrompt.message || "Enter a value"}
              <input
                autoFocus
                className="neu-inset min-h-10 rounded-xl border border-transparent bg-(--color-surface-input) px-3 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                id="browser-prompt-input"
                onChange={(event) => setPromptValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    respondToPrompt(promptValue);
                  }
                }}
                value={promptValue}
              />
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="min-h-9 rounded-xl px-3 text-sm font-medium text-muted transition hover:bg-hover hover:text-text"
                onClick={() => respondToPrompt(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-9 rounded-xl bg-primary px-3 text-sm font-medium text-accent-foreground transition hover:bg-primary-hover"
                onClick={() => respondToPrompt(promptValue)}
                type="button"
              >
                Submit
              </button>
            </div>
          </div>
        )}
        {srcDoc ? (
          <iframe
            className="h-48 w-full rounded-xl border border-border bg-white"
            ref={iframeRef}
            sandbox={isExecuting ? "allow-scripts" : ""}
            srcDoc={srcDoc}
            title="Isolated browser snippet preview"
          />
        ) : (
          <div className="flex h-48 items-center justify-center rounded-xl border border-border bg-app px-4 text-center text-xs text-muted">
            Run browser code to see its isolated preview.
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-text">Browser console</p>
        <pre className="execution-console min-h-16 overflow-x-auto whitespace-pre-wrap wrap-break-words rounded-xl bg-(--color-surface-secondary) px-4 py-3 font-mono text-xs leading-5 text-text">
          {entries.length
            ? entries.map((entry) => `[${entry.level}] ${entry.message}`).join("\n")
            : "No console output."}
        </pre>
      </div>
    </div>
  );
}
