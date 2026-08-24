import { useCallback, useRef, useState } from "react";

import type {
  BrowserExecutionCompletion,
  BrowserExecutionRequest,
  ExecutionLanguage,
  ExecutionPanelState,
} from "../types/execution";

const transpileBrowserTypeScript = async (code: string) => {
  const ts = await import("typescript");
  const result = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });

  const diagnostic = result.diagnostics?.find(
    (item) => item.category === ts.DiagnosticCategory.Error,
  );

  if (diagnostic) {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
  }

  return result.outputText;
};

export function useBrowserExecution() {
  const nextRequestId = useRef(0);
  const [request, setRequest] = useState<BrowserExecutionRequest>();
  const [state, setState] = useState<ExecutionPanelState>({ status: "idle" });

  const run = useCallback(async ({
    code,
    language,
    timeoutMs,
  }: {
    code: string;
    language: ExecutionLanguage;
    timeoutMs: number;
  }) => {
    const requestId = ++nextRequestId.current;
    try {
      setState({ status: "running" });
      const executableCode =
        language === "typescript" ? await transpileBrowserTypeScript(code) : code;

      if (requestId !== nextRequestId.current) return;

      setRequest({
        code: executableCode,
        id: requestId,
        timeoutMs,
      });
    } catch (error) {
      if (requestId !== nextRequestId.current) return;
      const message = error instanceof Error ? error.message : "Unable to compile TypeScript.";
      setRequest(undefined);
      setState({
        status: "failed",
        result: {
          browserConsole: [],
          durationMs: 0,
          error: { code: "BROWSER_COMPILE_ERROR", message },
          exitCode: null,
          runtime: "browser",
          status: "failed",
          stderr: message,
          stdout: "",
        },
      });
    }
  }, []);

  const complete = useCallback((completion: BrowserExecutionCompletion) => {
    const stderr = completion.error ?? "";
    setState({
      status: completion.status,
      result: {
        browserConsole: completion.consoleEntries,
        durationMs: completion.durationMs,
        error: completion.error
          ? { code: "BROWSER_EXECUTION_ERROR", message: completion.error }
          : null,
        exitCode: completion.status === "completed" ? 0 : null,
        runtime: "browser",
        status: completion.status,
        stderr,
        stdout: completion.consoleEntries.map((entry) => entry.message).join("\n"),
      },
    });
  }, []);

  const clear = useCallback(() => {
    nextRequestId.current += 1;
    setRequest(undefined);
    setState({ status: "idle" });
  }, []);

  return {
    clear,
    complete,
    isRunning: state.status === "running",
    request,
    run,
    state,
  };
}
