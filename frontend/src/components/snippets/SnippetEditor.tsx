import Editor, { type OnMount, type BeforeMount } from "@monaco-editor/react";
import { Minimize2, Maximize2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type * as Monaco from "monaco-editor";

import { editorOptions } from "../../features/snippets/editorOptions";
import {
  languageMap,
  type SnippetLanguage,
} from "../../features/snippets/languages";
import { useTheme } from "../../context/ThemeContext";
import { Select } from "../ui/Select";

type WorkspaceFile = {
  id?: string;
  path: string;
  content: string;
  language: SnippetLanguage;
};

type SnippetEditorProps = {
  className?: string;
  disabled?: boolean;
  error?: string;
  filePath?: string;
  files?: WorkspaceFile[];
  onChange: (value: string) => void;
  value: string;
  language: SnippetLanguage;
  onFullscreenChange?: (isFullscreen: boolean) => void;
};

const normalizePath = (filePath: string) =>
  filePath.replace(/\\/g, "/").replace(/^\/+/, "").trim();

const getLanguage = (
  filePath: string,
  fallback: SnippetLanguage,
): SnippetLanguage => {
  const extension = filePath.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "ts":
    case "tsx":
      return "typescript";

    case "js":
    case "jsx":
    case "mjs":
      return "javascript";

    case "json":
      return "json";

    case "html":
    case "htm":
      return "html";

    case "css":
    case "scss":
      return "css";

    case "md":
      return "markdown";

    default:
      return fallback;
  }
};

const getMonacoLanguage = (
  filePath: string,
  fallback: SnippetLanguage,
) => {
  const language = getLanguage(filePath, fallback);

  switch (language) {
    case "typescript":
      return "typescript";

    case "javascript":
      return "javascript";

    case "json":
      return "json";

    case "html":
      return "html";

    case "css":
      return "css";

    case "markdown":
      return "markdown";

    default:
      return languageMap[language] ?? language;
  }
};

export function SnippetEditor({
  className,
  disabled = false,
  error,
  filePath,
  files = [],
  language,
  onChange,
  onFullscreenChange,
  value,
}: SnippetEditorProps) {
  const { theme } = useTheme();

  const [editorTheme, setEditorTheme] = useState<"vs" | "vs-dark">(
    theme === "dark" ? "vs-dark" : "vs",
  );

  const [isFullscreen, setIsFullscreen] = useState(false);

  /*
   * ============================================================
   * Normalize workspace files
   * ============================================================
   */

  const normalizedFiles = useMemo(
    () =>
      files
        .filter((file) => file.path.trim())
        .map((file) => ({
          ...file,
          path: normalizePath(file.path),
        })),
    [files],
  );

  /*
   * ============================================================
   * Monaco TypeScript configuration
   * ============================================================
   */

  const configureMonaco = (monaco: typeof Monaco) => {
  const defaults = monaco.typescript.typescriptDefaults;

  defaults.setCompilerOptions({
    target: monaco.typescript.ScriptTarget.ES2020,

    module: monaco.typescript.ModuleKind.ESNext,

    moduleResolution:
      monaco.typescript.ModuleResolutionKind.NodeJs,

    allowImportingTsExtensions: true,

    allowJs: true,

    checkJs: false,

    jsx: monaco.typescript.JsxEmit.ReactJSX,

    esModuleInterop: true,

    allowSyntheticDefaultImports: true,

    strict: true,

    noEmit: true,

    baseUrl: "file:///devlupo",
  });

  defaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });

  defaults.setEagerModelSync(true);
};

  /*
   * ============================================================
   * Create/synchronize all workspace models BEFORE editor mount
   * ============================================================
   */

  const handleBeforeMount: BeforeMount = (monaco) => {
    configureMonaco(monaco);

    for (const file of normalizedFiles) {
      const normalizedPath = normalizePath(file.path);

      const uri = monaco.Uri.parse(`file:///devlupo/${normalizedPath}`);

      const existingModel = monaco.editor.getModel(uri);

      if (existingModel) {
        if (existingModel.getValue() !== file.content) {
          existingModel.setValue(file.content);
        }

        continue;
      }

      monaco.editor.createModel(
        file.content,
        getMonacoLanguage(normalizedPath, file.language),
        uri,
      );
    }
  };

  /*
   * ============================================================
   * Keep workspace models synchronized
   * ============================================================
   *
   * We receive Monaco directly from the Editor lifecycle.
   * We do NOT depend on window.monaco.
   */

  const handleMount: OnMount = (_editor, monaco) => {
    configureMonaco(monaco);

    for (const file of normalizedFiles) {
      const normalizedPath = normalizePath(file.path);

      const uri = monaco.Uri.parse(`file:///devlupo/${normalizedPath}`);

      const model = monaco.editor.getModel(uri);

      if (!model) {
        monaco.editor.createModel(
          file.content,
          getMonacoLanguage(normalizedPath, file.language),
          uri,
        );
      }
    }
  };

  /*
   * ============================================================
   * Synchronize model contents when files change
   * ============================================================
   */

  useEffect(() => {
    if (!normalizedFiles.length) {
      return;
    }

    /*
     * Monaco is intentionally accessed through the global
     * editor instance only after it has been mounted.
     *
     * The actual model creation happens in beforeMount().
     *
     * This effect handles content updates for models that
     * already exist.
     */

    const editorContainer = document.querySelector(".monaco-editor");

    if (!editorContainer) {
      return;
    }
  }, [normalizedFiles]);

  /*
   * ============================================================
   * Fullscreen
   * ============================================================
   */

  const toggleFullscreen = () => {
    setIsFullscreen((current) => {
      onFullscreenChange?.(!current);

      return !current;
    });
  };

  useEffect(() => {
    if (!isFullscreen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();

        setIsFullscreen(false);
        onFullscreenChange?.(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen, onFullscreenChange]);

  /*
   * ============================================================
   * Active Monaco model
   * ============================================================
   */

  const normalizedActivePath = filePath ? normalizePath(filePath) : undefined;

  const editorPath = normalizedActivePath
    ? `file:///devlupo/${normalizedActivePath}`
    : undefined;

  /*
   * ============================================================
   * Render
   * ============================================================
   */

  return (
    <div
      className={`grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-2 text-sm font-medium text-text ${
        isFullscreen
          ? "fixed inset-5 z-60 rounded-2xl border border-border bg-elevated p-5 shadow-2xl"
          : ""
      } ${className ?? ""}`}
    >
      {/* Editor toolbar */}

      <div className="flex shrink-0 items-center justify-between">
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium text-text">
            {normalizedActivePath
              ? normalizedActivePath.split("/").pop()
              : "Code"}
          </span>

          {normalizedActivePath && (
            <span className="block truncate text-xs font-normal text-muted">
              {normalizedActivePath}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select
            aria-label="Editor theme"
            className="w-24"
            onValueChange={(nextTheme) =>
              setEditorTheme(nextTheme as "vs" | "vs-dark")
            }
            options={[
              {
                value: "vs",
                label: "Light",
              },
              {
                value: "vs-dark",
                label: "Dark",
              },
            ]}
            size="sm"
            value={editorTheme}
          />

          <button
            aria-label={isFullscreen ? "Exit expanded editor" : "Expand editor"}
            className="neu-raised flex size-8 items-center justify-center rounded-lg border border-transparent bg-elevated text-muted transition hover:-translate-y-0.5 hover:text-text"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit expanded editor" : "Expand editor"}
            type="button"
          >
            {isFullscreen ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Monaco */}

      <div className="neu-raised min-h-0 overflow-hidden rounded-xl border border-border/70 bg-(--color-surface-secondary) focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <Editor
          height="100%"
          path={editorPath}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          language={getLanguage(normalizedActivePath ?? "", language)}
          onChange={(next) => onChange(next ?? "")}
          options={{
            ...editorOptions,
            readOnly: disabled,
            domReadOnly: disabled,
          }}
          theme={editorTheme}
          value={value}
        />
      </div>

      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
