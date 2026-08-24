import { useEffect, useRef, useState } from "react";

import type {
  BrowserConsoleEntry,
  BrowserExecutionCompletion,
  BrowserExecutionRequest,
} from "../../types/execution";

const channel = "devlupo-browser-execution";

const serialize = (value: string) =>
  JSON.stringify(value).replace(/</g, "\\u003c");

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
        let initialized = false;
        let finished = false;
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
          new Function(code)();
          initialized = true;
          completeIfIdle();
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

export function BrowserPreview({ request, onComplete }: BrowserPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const entriesRef = useRef<BrowserConsoleEntry[]>([]);
  const completedRef = useRef(false);
  const startedAtRef = useRef(0);
  const [entries, setEntries] = useState<BrowserConsoleEntry[]>([]);
  const [srcDoc, setSrcDoc] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    entriesRef.current = [];
    setEntries([]);
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
        runId?: number;
        type?: "complete" | "console" | "error";
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
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
    };
  }, [onComplete, request]);

  return (
    <div className="mb-5 space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium text-text">Browser preview</p>
        {srcDoc ? (
          <iframe
            className="h-48 w-full rounded-xl border border-border bg-white"
            ref={iframeRef}
            sandbox={isExecuting ? "allow-scripts allow-modals" : ""}
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
