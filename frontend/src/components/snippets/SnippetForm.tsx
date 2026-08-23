import { Controller, useForm } from "react-hook-form";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  languageLabels,
  languages,
} from "../../features/snippets/languages";
import { useRunExecution } from "../../services/useExecution";
import { useProjects } from "../../services/useProjects";
import type { Snippet, SnippetInput } from "../../types/snippet";
import { toast } from "sonner";
import { ExecutionOutput } from "./ExecutionOutput";
import { Input } from "../ui/Input";
import { Textarea } from "../ui/Textarea";
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
}).superRefine((values, context) => {
  if (!values.projectId) return;

  const filePath = values.filePath?.trim();
  if (!filePath) {
    context.addIssue({
      code: "custom",
      message: "File path is required for project snippets.",
      path: ["filePath"],
    });
    return;
  }

  if (filePath.includes("\0")) {
    context.addIssue({
      code: "custom",
      message: "File path cannot contain null bytes.",
      path: ["filePath"],
    });
  } else if (filePath.startsWith("/") || filePath.includes(":")) {
    context.addIssue({
      code: "custom",
      message: "File path must be relative to the project root.",
      path: ["filePath"],
    });
  } else if (filePath.includes("\\")) {
    context.addIssue({
      code: "custom",
      message: "File path must use forward slashes.",
      path: ["filePath"],
    });
  } else if (
    filePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    context.addIssue({
      code: "custom",
      message: "File path must be a safe relative project path.",
      path: ["filePath"],
    });
  }
});

type Values = z.infer<typeof schema>;

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
  onSubmit: (input: SnippetInput) => void;
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
  const execution = useRunExecution();
  const [stdin, setStdin] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(10000);
  const isProjectSnippet = Boolean(projectId);
  const isRunnableLanguage = language === "javascript" || language === "typescript";

  return (
    <form
      className="grid min-h-0 grid-cols-1 overflow-y-auto lg:h-full lg:grid-cols-[minmax(0,1.65fr)_minmax(360px,1fr)] lg:overflow-hidden"
      id={formId}
      noValidate
      onSubmit={handleSubmit((values) => {
        onSubmit({
          ...values,
          projectId: values.projectId || undefined,
          filePath: values.projectId ? values.filePath || undefined : null,
        });
      })}
    >
      {/* LEFT SIDE */}
      <div className="flex min-h-0 min-w-0 flex-col border-b border-border-subtle px-5 py-4 lg:border-b-0 lg:border-r">
        {/* Top fields */}
        <div className="shrink-0 space-y-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1.7fr)_minmax(170px,0.8fr)_minmax(170px,0.8fr)]">
            <Input
              autoFocus
              disabled={isSubmitting}
              error={errors.title?.message}
              label="Title"
              {...register("title")}
            />

            <div className="min-w-0">
              <label
                className="mb-1.5 block text-xs font-medium text-text"
                htmlFor="snippet-language"
              >
                Language
              </label>

              <select
                className="h-10 mt-2 w-full rounded-lg border border-border bg-app px-3 text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                disabled={isSubmitting}
                id="snippet-language"
                {...register("language")}
              >
                <option value="">Select language</option>

                {languages.map((item) => (
                  <option key={item} value={item}>
                    {languageLabels[item]}
                  </option>
                ))}
              </select>

              {errors.language && (
                <p className="mt-1 text-xs text-danger">
                  {errors.language.message}
                </p>
              )}
            </div>

            <div className="min-w-0">
              <label
                className="mb-1.5 mt-2 block text-xs font-medium text-text"
                htmlFor="snippet-project"
              >
                Project (optional)
              </label>

              <select
                className="h-10 w-full rounded-lg border border-border bg-app px-3 text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                disabled={isSubmitting}
                id="snippet-project"
                {...register("projectId")}
              >
                <option value="">Personal snippet</option>

                {projects?.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {projectId && (
            
            <Input
              disabled={isSubmitting}
              error={errors.filePath?.message}
              helperText="Path relative to the project root."
              label="File path"
              placeholder="E.g.src/controllers/my.controller.ts"
              {...register("filePath")}
              
            />
          )}

          <Textarea
            className="min-h-20 resize-none"
            disabled={isSubmitting}
            error={errors.description?.message}
            label="Description (optional)"
            {...register("description")}
          />
        </div>

        {/* Editor */}
        <div className="mt-4 min-h-72 flex-1 lg:min-h-0">
          <Controller
            control={control}
            name="code"
            render={({ field }) => (
              <SnippetEditor
                className="h-full min-h-0"
                disabled={isSubmitting}
                error={errors.code?.message}
                language={language}
                onChange={field.onChange}
                onFullscreenChange={onEditorFullscreenChange}
                value={field.value}
              />
            )}
          />
        </div>
      </div>

      {/* RIGHT SIDE */}
      <Controller
        control={control}
        name="code"
        render={({ field }) => (
          <ExecutionOutput
            isRunning={execution.isRunning}
            onRun={() => {
              if (!field.value.trim()) {
                toast.error("Nothing to run.");
                return;
              }

              if (!isRunnableLanguage) {
                toast.error("Only JavaScript and TypeScript can be run right now.");
                return;
              }

              if (projectId) {
                const entryPoint = filePath?.trim();
                if (!entryPoint) {
                  toast.error("Project snippets need a file path before they can be run.");
                  return;
                }

                if (
                  entryPoint.includes("\0") ||
                  entryPoint.startsWith("/") ||
                  entryPoint.includes(":") ||
                  entryPoint.includes("\\") ||
                  entryPoint.split("/").some(
                    (segment) => !segment || segment === "." || segment === "..",
                  )
                ) {
                  toast.error("Enter a safe file path relative to the project root.");
                  return;
                }

                if (isDirty) {
                  toast.info("Project execution uses saved project files. Save changes to run your edits.");
                }

                execution.runProject(projectId, {
                  entryPoint,
                  stdin,
                  timeoutMs,
                });
                return;
              }

              execution.runStandalone({
                language,
                framework: "node",
                entryPoint: "index.js",
                files: [
                  {
                    path: "index.js",
                    content: field.value,
                  },
                ],
                stdin,
                timeoutMs,
              });
            }}
            runLabel={isProjectSnippet ? "Run Project" : "Run"}
            stdin={stdin}
            onStdinChange={setStdin}
            onClear={execution.clear}
            onTimeoutChange={setTimeoutMs}
            state={execution.state}
            timeoutMs={timeoutMs}
          />
        )}
      />
    </form>
  );
}
