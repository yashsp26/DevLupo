import Editor from "@monaco-editor/react";
import {
  Minimize2,
  Maximize2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { editorOptions } from "../../features/snippets/editorOptions";
import {
  languageMap,
  type SnippetLanguage,
} from "../../features/snippets/languages";
import { useTheme } from "../../context/ThemeContext";
import { Select } from "../ui/Select";

type SnippetEditorProps = {
  className?: string;
  disabled?: boolean;
  error?: string;
  filePath?: string;
  onChange: (value: string) => void;
  value: string;
  language: SnippetLanguage;
  onFullscreenChange?: (isFullscreen: boolean) => void;
};

export function SnippetEditor({
  className,
  disabled = false,
  error,
  filePath,
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

  const toggleFullscreen = () => {
    setIsFullscreen((current) => {
      onFullscreenChange?.(!current);
      return !current;
    });
  };

  useEffect(() => {
    if (!isFullscreen) return;

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

  return (
    <div
      className={`grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-2 text-sm font-medium text-text ${isFullscreen ? "fixed inset-5 z-[60] rounded-2xl border border-border bg-elevated p-5 shadow-2xl" : ""} ${className ?? ""}`}
    >
      {/* Editor toolbar */}
      <div className="flex shrink-0 items-center justify-between">
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium text-text">
            {filePath ? filePath.split("/").pop() : "Code"}
          </span>
          {filePath && (
            <span className="block truncate text-xs font-normal text-muted">
              {filePath}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select
            aria-label="Editor theme"
            className="w-24"
            onValueChange={(value) => setEditorTheme(value as "vs" | "vs-dark")}
            options={[
              { value: "vs", label: "Light" },
              { value: "vs-dark", label: "Dark" },
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
            {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
        </div>
      </div>

      {/* Monaco */}
      <div className="neu-raised min-h-0 overflow-hidden rounded-xl border border-border/70 bg-[var(--color-surface-secondary)] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <Editor
          height="100%"
          language={languageMap[language] ?? language}
          onChange={(next) =>
            onChange(next ?? "")
          }
          options={{
            ...editorOptions,
            readOnly: disabled,
            domReadOnly: disabled,
          }}
          theme={editorTheme}
          value={value}
        />
      </div>

      {error && (
        <span className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
