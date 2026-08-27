import { Controller, useForm } from "react-hook-form";
import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Braces,
  FileCode2,
  FileJson2,
  FileText,
  FolderTree,
  Palette,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  languageLabels,
  languages,
  type SnippetLanguage,
} from "../../features/snippets/languages";
import { useProjects } from "../../services/useProjects";
import { usePreview } from "../../services/usePreview";
import { useRunExecution } from "../../services/useExecution";
import { useSnippets } from "../../services/useSnippets";
import type { ExecutionRuntime } from "../../types/execution";
import type { Snippet, SnippetInput } from "../../types/snippet";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Textarea } from "../ui/Textarea";
import { ExecutionOutput } from "./ExecutionOutput";
import { SnippetEditor } from "./SnippetEditor";

const schema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Title must be at least 2 characters.")
    .max(120),

  description: z
    .string()
    .trim()
    .max(500, "Description cannot exceed 500 characters."),

  language: z.enum(languages, "Choose a language."),

  code: z.string().trim().min(1, "Code cannot be empty."),

  projectId: z.string().optional(),

  filePath: z
    .string()
    .trim()
    .max(512, "File path cannot exceed 512 characters.")
    .optional(),
});

type Values = z.infer<typeof schema>;

type WorkspaceFile = {
  id?: string;
  path: string;
  content: string;
  language: SnippetLanguage;
};

type RelatedSnippetUpdate = {
  id: string;
  payload: SnippetInput;
};

const languageForPath = (
  path: string,
  fallback: SnippetLanguage,
): SnippetLanguage => {
  const extension = path.split(".").pop()?.toLowerCase();

  return (
    (
      {
        html: "html",
        htm: "html",
        css: "css",
        scss: "scss",
        js: "javascript",
        jsx: "javascript",
        ts: "typescript",
        tsx: "typescript",
        json: "json",
        md: "markdown",
        yml: "yaml",
        yaml: "yaml",
        xml: "xml",
      } as Record<string, SnippetLanguage>
    )[extension ?? ""] ?? fallback
  );
};

const fileIcon = (path: string) => {
  const extension = path.split(".").pop()?.toLowerCase();

  if (extension === "css" || extension === "scss") {
    return Palette;
  }

  if (extension === "json") {
    return FileJson2;
  }

  if (["js", "ts", "jsx", "tsx"].includes(extension ?? "")) {
    return Braces;
  }

  if (["html", "xml"].includes(extension ?? "")) {
    return FileCode2;
  }

  return FileText;
};

/*
 * Existing snippet path.
 *
 * IMPORTANT:
 * There is intentionally NO index.js/index.ts fallback here.
 *
 * An unnamed single-file snippet is allowed to remain unnamed.
 */
const getExistingSnippetPath = (
  snippet?: Snippet,
  isProject = false,
): string => {
  const explicitPath = snippet?.filePath?.trim();

  if (explicitPath) {
    return explicitPath;
  }

  if (isProject && snippet?.title?.trim()) {
    return snippet.title.trim();
  }

  return "";
};

export function SnippetForm({
  formId,
  snippet,
  isSubmitting,
  onEditorFullscreenChange,
  onSubmit,
}: {
  formId: string;
  snippet?: Snippet;
  isSubmitting: boolean;
  onEditorFullscreenChange: (isFullscreen: boolean) => void;
  onSubmit: (
    input: SnippetInput,
    relatedUpdates: RelatedSnippetUpdate[],
  ) => void | Promise<void>;
}) {
  const { data: projects } = useProjects({
    limit: 100,
    sort: "name",
    order: "asc",
  });

  const {
    control,
    formState: { errors, isDirty },
    register,
    watch,
    handleSubmit,
    setValue,
  } = useForm<Values>({
    defaultValues: {
      title: snippet?.title ?? "",
      description: snippet?.description ?? "",
      language: snippet?.language ?? "typescript",
      code: snippet?.code ?? "",
      projectId: snippet?.projectId ?? "",
      filePath: snippet?.filePath ?? "",
    },
    resolver: zodResolver(schema),
  });

  const language = watch("language");
  const projectId = watch("projectId");
  const filePath = watch("filePath");
  const primaryCode = watch("code");

  const projectSnippets = useSnippets(
    {
      projectId: projectId ?? "",
      limit: 100,
      sort: "title",
      order: "asc",
    },
    Boolean(projectId),
  );

  /*
   * ------------------------------------------------------------
   * Primary path
   * ------------------------------------------------------------
   *
   * Single-file snippets are allowed to have no path.
   *
   * Project files must have a path.
   */
  const primaryPath = useMemo(() => {
    if (filePath?.trim()) {
      return filePath.trim();
    }

    return getExistingSnippetPath(snippet, Boolean(projectId));
  }, [filePath, snippet, projectId]);

  /*
   * Internal state key.
   *
   * This is NOT a filename.
   * It is only used because React state objects need a key.
   */
  const unnamedFileKey = "__unnamed_single_file__";

  const initialPath = getExistingSnippetPath(
    snippet,
    Boolean(snippet?.projectId),
  );

  const [activeFilePath, setActiveFilePath] = useState(
    initialPath || unnamedFileKey,
  );

  const [fileContents, setFileContents] = useState<
    Record<string, WorkspaceFile>
  >({});

  const nodeExecution = useRunExecution();
  const preview = usePreview();

  const [stdin, setStdin] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(10000);
  const [runtime, setRuntime] = useState<ExecutionRuntime>("node");

  /*
   * ------------------------------------------------------------
   * Language change
   * ------------------------------------------------------------
   */
  useEffect(() => {
    nodeExecution.clear();
    preview.clear();

    if (language === "html") {
      setRuntime("browser");
    }
  }, [language]);

  /*
   * ------------------------------------------------------------
   * Primary snippet initialization
   * ------------------------------------------------------------
   */
  useEffect(() => {
    const stateKey = primaryPath || unnamedFileKey;

    setActiveFilePath(stateKey);

    setFileContents({
      [stateKey]: {
        id: snippet?.id,
        path: primaryPath,
        content: primaryCode,
        language: primaryPath
          ? languageForPath(primaryPath, language)
          : language,
      },
    });
  }, [snippet?.id]);

  /*
   * ------------------------------------------------------------
   * Project change
   * ------------------------------------------------------------
   */
  useEffect(() => {
    const stateKey = primaryPath || unnamedFileKey;

    setActiveFilePath(stateKey);

    setFileContents({
      [stateKey]: {
        id: snippet?.id,
        path: primaryPath,
        content: primaryCode,
        language: primaryPath
          ? languageForPath(primaryPath, language)
          : language,
      },
    });
  }, [projectId]);

  /*
   * ------------------------------------------------------------
   * Load project files
   * ------------------------------------------------------------
   */
  useEffect(() => {
    if (!projectId) {
      return;
    }

    setFileContents((current) => {
      const next = { ...current };

      for (const item of projectSnippets.data?.snippets ?? []) {
        const path = item.filePath?.trim() || item.title.trim();

        if (!path) {
          continue;
        }

        if (!next[path]) {
          next[path] = {
            id: item.id,
            path,
            content: item.id === snippet?.id ? primaryCode : item.code,
            language: languageForPath(path, item.language),
          };
        }
      }

      if (primaryPath && !next[primaryPath]) {
        next[primaryPath] = {
          id: snippet?.id,
          path: primaryPath,
          content: primaryCode,
          language: languageForPath(primaryPath, language),
        };
      }

      return next;
    });
  }, [projectId, projectSnippets.data?.snippets, snippet?.id]);

  /*
   * ------------------------------------------------------------
   * Keep primary file synchronized
   * ------------------------------------------------------------
   */
  useEffect(() => {
    const stateKey = primaryPath || unnamedFileKey;

    setFileContents((current) => ({
      ...current,

      [stateKey]: {
        ...(current[stateKey] ?? {
          id: snippet?.id,
          path: primaryPath,
          language,
        }),

        id: snippet?.id,
        path: primaryPath,
        content: primaryCode,
        language: primaryPath
          ? languageForPath(primaryPath, language)
          : language,
      },
    }));
  }, [primaryPath, primaryCode, language, snippet?.id]);

  /*
   * ------------------------------------------------------------
   * File list
   * ------------------------------------------------------------
   *
   * Only real filenames are displayed.
   *
   * Unnamed single files are intentionally not shown as
   * "index.js", "index.ts", etc.
   */
  const files = useMemo(
    () =>
      Object.values(fileContents)
        .filter((file) => file.path.trim())
        .sort((a, b) => a.path.localeCompare(b.path)),
    [fileContents],
  );

  /*
   * ------------------------------------------------------------
   * Active file
   * ------------------------------------------------------------
   */
  const activeFile = fileContents[activeFilePath] ??
    fileContents[primaryPath] ?? {
      id: snippet?.id,
      path: primaryPath,
      content: primaryCode,
      language: primaryPath ? languageForPath(primaryPath, language) : language,
    };

  /*
   * ------------------------------------------------------------
   * Browser project detection
   * ------------------------------------------------------------
   *
   * Existing browser-project behavior is preserved.
   *
   * Additionally, an HTML single-file snippet is a browser
   * execution target even when the user did not provide a
   * filename.
   */
  const projectEntryPoint = useMemo(
    () => files.find((file) => file.path === "index.html")?.path,
    [files],
  );

  const isSingleFileBrowserSnippet = !projectId && language === "html";

  const isBrowserProject =
    Boolean(projectEntryPoint) || isSingleFileBrowserSnippet;

  /*
   * ------------------------------------------------------------
   * Browser execution entry point
   * ------------------------------------------------------------
   *
   * IMPORTANT:
   *
   * "index.html" here is ONLY an execution-time fallback.
   *
   * It is NOT:
   * - written to filePath
   * - shown in the UI
   * - saved to the snippet
   */
  const browserEntryPoint =
    projectEntryPoint || activeFile.path || "index.html";

  /*
   * ------------------------------------------------------------
   * File switching
   * ------------------------------------------------------------
   */
  const selectFile = (path: string) => {
    setActiveFilePath(path);
  };

  const updateActiveFile = (content: string) => {
    setFileContents((current) => ({
      ...current,

      [activeFilePath]: {
        ...activeFile,
        content,
      },
    }));

    if (activeFile.path === primaryPath) {
      setValue("code", content, {
        shouldDirty: true,
      });
    }
  };

  /*
   * ------------------------------------------------------------
   * RUN
   * ------------------------------------------------------------
   */
  const run = () => {
    if (!activeFile.content.trim()) {
      return toast.error("Nothing to run.");
    }

    /*
     * ==========================================================
     * BROWSER PREVIEW
     * ==========================================================
     *
     * Existing multifile browser behavior is preserved.
     *
     * Single unnamed HTML snippets receive a temporary
     * index.html only for the preview request.
     */
    if (isBrowserProject) {
      let browserFiles = files.map(({ path, content }) => ({
        path,
        content,
      }));

      /*
       * Unnamed single HTML snippet.
       *
       * Since it intentionally has no filename in the UI,
       * create the browser entry only for execution.
       */
      if (!projectId && !projectEntryPoint && language === "html") {
        browserFiles = [
          {
            path: "index.html",
            content: activeFile.content,
          },
        ];
      }

      /*
       * Named single HTML snippet.
       *
       * The existing filename is used as the entry point.
       */
      if (
        !projectId &&
        activeFile.path &&
        !projectEntryPoint &&
        language === "html" &&
        browserFiles.length === 0
      ) {
        browserFiles = [
          {
            path: activeFile.path,
            content: activeFile.content,
          },
        ];
      }

      preview.create({
        language: "html",
        runtime: "browser",
        entryPoint: browserEntryPoint,
        files: browserFiles,
      });

      return;
    }

    /*
     * ==========================================================
     * NODE EXECUTION
     * ==========================================================
     */
    if (language !== "javascript" && language !== "typescript") {
      return toast.error(
        "Only JavaScript and TypeScript can be run with Node.js.",
      );
    }

    /*
     * ==========================================================
     * MULTI-FILE PROJECT
     * ==========================================================
     */
    if (projectId) {
      if (!primaryPath) {
        return toast.error(
          "Project snippets need a file path before they can be run.",
        );
      }

      if (isDirty) {
        toast.info(
          "Project execution uses saved project files. Save changes to run your edits.",
        );
      }

      nodeExecution.runProject(projectId, {
        entryPoint: primaryPath,
        stdin,
        timeoutMs,
      });

      return;
    }

    /*
     * ==========================================================
     * SINGLE FILE JAVASCRIPT / TYPESCRIPT
     * ==========================================================
     *
     * Unnamed snippets get a temporary execution path.
     *
     * This does NOT affect the UI or saved data.
     */
    const executionPath =
      activeFile.path ||
      (activeFile.language === "typescript" ? "main.ts" : "main.js");

    nodeExecution.runStandalone({
      language: activeFile.language as "javascript" | "typescript",

      runtime,

      framework: runtime,

      entryPoint: executionPath,

      files: [
        {
          path: executionPath,
          content: activeFile.content,
        },
      ],

      stdin,
      timeoutMs,
    });
  };

  const languageOptions = languages.map((item) => ({
    value: item,
    label: languageLabels[item],
  }));

  const projectOptions = [
    {
      value: "",
      label: "Personal snippet",
    },

    ...(projects?.projects ?? []).map((project) => ({
      value: project.id,
      label: project.name,
    })),
  ];

  return (
    <form
      className="grid min-h-0 grid-cols-1 overflow-y-auto xl:h-full xl:grid-cols-[minmax(210px,.42fr)_minmax(0,1.2fr)_minmax(320px,.62fr)] xl:overflow-hidden"
      id={formId}
      noValidate
      onSubmit={handleSubmit((values) => {
        const currentContent =
          fileContents[primaryPath || unnamedFileKey]?.content ?? values.code;

        const relatedUpdates = (projectSnippets.data?.snippets ?? []).flatMap(
          (item) => {
            const path = item.filePath || item.title;

            const edited = fileContents[path];

            if (
              !edited ||
              edited.id === snippet?.id ||
              edited.content === item.code
            ) {
              return [];
            }

            return [
              {
                id: item.id,
                payload: {
                  title: item.title,
                  description: item.description,
                  language: item.language,
                  code: edited.content,
                  projectId: item.projectId,
                  filePath: item.filePath,
                },
              },
            ];
          },
        );

        onSubmit(
          {
            ...values,

            code: currentContent,

            projectId: values.projectId || undefined,

            /*
             * Single-file filename remains optional.
             *
             * Projects require a path.
             */
            filePath: values.projectId
              ? values.filePath || undefined
              : values.filePath?.trim()
                ? values.filePath.trim()
                : null,
          },
          relatedUpdates,
        );
      })}
    >
      {/* ======================================================
          LEFT — FILE DETAILS
          ====================================================== */}

      <aside className="min-h-0 overflow-y-auto border-b border-border-subtle bg-elevated p-4 xl:border-r xl:border-b-0">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-text">
          <FolderTree className="size-4 text-primary" />
          File details
        </div>

        <div className="space-y-4">
          <Input
            autoFocus
            disabled={isSubmitting}
            error={errors.title?.message}
            label="Snippet title"
            {...register("title")}
          />

          <Textarea
            className="min-h-24 resize-none"
            disabled={isSubmitting}
            error={errors.description?.message}
            label="Description"
            {...register("description")}
          />

          <Controller
            control={control}
            name="language"
            render={({ field }) => (
              <label className="grid gap-2 text-sm font-medium text-text">
                Language
                <Select
                  disabled={isSubmitting}
                  onBlur={field.onBlur}
                  onValueChange={(value) => field.onChange(value)}
                  options={languageOptions}
                  value={field.value}
                />
              </label>
            )}
          />

          <Controller
            control={control}
            name="projectId"
            render={({ field }) => (
              <label className="grid gap-2 text-sm font-medium text-text">
                Project
                <Select
                  disabled={isSubmitting}
                  onBlur={field.onBlur}
                  onValueChange={(value) => field.onChange(value)}
                  options={projectOptions}
                  value={field.value || ""}
                />
              </label>
            )}
          />

          {projectId && (
            <Input
              disabled={isSubmitting}
              error={errors.filePath?.message}
              helperText="Relative to project root"
              label="File path"
              placeholder="src/index.ts"
              {...register("filePath")}
            />
          )}

          {!projectId && (
            <Input
              disabled={isSubmitting}
              error={errors.filePath?.message}
              helperText="Optional for single-file snippets"
              label="File name (optional)"
              placeholder="e.g. normalize.ts"
              {...register("filePath")}
            />
          )}
        </div>

        {/* ====================================================
            FILE EXPLORER
            ==================================================== */}

        <div className="mt-6 border-t border-border-subtle pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {projectId ? "Project files" : "File"}
          </p>

          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {files.length > 0 ? (
              files.map((file) => {
                const Icon = fileIcon(file.path);

                const active = file.path === activeFile.path;

                return (
                  <button
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                      active
                        ? "bg-primary/10 text-primary shadow-(--shadow-inset)"
                        : "text-muted hover:bg-hover hover:text-text"
                    }`}
                    key={file.path}
                    onClick={() => selectFile(file.path)}
                    title={file.path}
                    type="button"
                  >
                    <Icon
                      className={`size-4 shrink-0 ${
                        active ? "text-primary" : "text-muted"
                      }`}
                    />

                    <span className="truncate">{file.path}</span>
                  </button>
                );
              })
            ) : (
              <div className="rounded-lg px-3 py-2 text-sm text-muted">
                Unnamed file
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ======================================================
          CENTER — CODE EDITOR
          ====================================================== */}

      <main className="min-h-105 min-w-0 border-b border-border-subtle p-4 xl:min-h-0 xl:border-r xl:border-b-0">
        <SnippetEditor
          className="h-full min-h-97.5"
          disabled={isSubmitting}
          error={
            activeFile.path === primaryPath ? errors.code?.message : undefined
          }
          filePath={activeFile.path || undefined}
          language={activeFile.language}
          onChange={updateActiveFile}
          onFullscreenChange={onEditorFullscreenChange}
          value={activeFile.content}
        />
      </main>

      {/* ======================================================
          RIGHT — EXECUTION
          ====================================================== */}

      <ExecutionOutput
        isBrowserProject={isBrowserProject}
        isRunning={
          isBrowserProject ? preview.isCreating : nodeExecution.isRunning
        }
        onClear={() => {
          nodeExecution.clear();
          preview.clear();
        }}
        onPreviewRefresh={run}
        onRun={run}
        onRuntimeChange={setRuntime}
        preview={preview.preview}
        previewError={preview.error}
        runLabel={
          isBrowserProject ? "Preview" : projectId ? "Run project" : "Run"
        }
        runtime={runtime}
        stdin={stdin}
        onStdinChange={setStdin}
        onTimeoutChange={setTimeoutMs}
        state={nodeExecution.state}
        timeoutMs={timeoutMs}
      />
    </form>
  );
}
