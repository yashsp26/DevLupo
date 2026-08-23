import Editor from "@monaco-editor/react";
import {
  Minimize2,
  Maximize2,
  ChevronDown,
} from "lucide-react";
import { useEffect, useState } from "react";

import { editorOptions } from "../../features/snippets/editorOptions";
import {
  languageMap,
  type SnippetLanguage,
} from "../../features/snippets/languages";
import { useTheme } from "../../context/ThemeContext";

type SnippetEditorProps = {
  className?: string;
  disabled?: boolean;
  error?: string;
  onChange: (value: string) => void;
  value: string;
  language: SnippetLanguage;
  onFullscreenChange?: (isFullscreen: boolean) => void;
};

export function SnippetEditor({
  className,
  disabled = false,
  error,
  language,
  onChange,
  onFullscreenChange,
  value,
}: SnippetEditorProps) {
  const { theme } = useTheme();
  const [editorTheme, setEditorTheme] = useState<"vs" | "vs-dark">(
    theme === "dark" ? "vs-dark" : "vs",
  );
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
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
        <span className="text-sm font-medium text-text">
          Code
        </span>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              aria-expanded={isThemeMenuOpen}
              aria-haspopup="menu"
              className="neu-raised flex h-8 items-center gap-2 rounded-lg border border-transparent bg-elevated px-3 text-xs font-medium text-text transition hover:-translate-y-0.5"
              onClick={() => setIsThemeMenuOpen((open) => !open)}
              type="button"
            >
              {editorTheme === "vs-dark" ? "Dark" : "Light"}
              <ChevronDown className="size-3.5 text-muted" />
            </button>
            {isThemeMenuOpen && (
              <div className="absolute right-0 z-10 mt-2 w-28 rounded-lg border border-border bg-elevated p-1 shadow-lg" role="menu">
                {(["vs", "vs-dark"] as const).map((nextTheme) => (
                  <button
                    className="block w-full rounded-md px-3 py-2 text-left text-xs text-text hover:bg-hover"
                    key={nextTheme}
                    onClick={() => {
                      setEditorTheme(nextTheme);
                      setIsThemeMenuOpen(false);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {nextTheme === "vs-dark" ? "Dark" : "Light"}
                  </button>
                ))}
              </div>
            )}
          </div>

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
