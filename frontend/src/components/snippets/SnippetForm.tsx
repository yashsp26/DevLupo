import { Controller, useForm } from "react-hook-form";
import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Braces, FileCode2, FileJson2, FileText, FolderTree, Palette } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { languageLabels, languages, type SnippetLanguage } from "../../features/snippets/languages";
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

const schema = z.object({ title: z.string().trim().min(2, "Title must be at least 2 characters.").max(120), description: z.string().trim().max(500, "Description cannot exceed 500 characters."), language: z.enum(languages, "Choose a language."), code: z.string().trim().min(1, "Code cannot be empty."), projectId: z.string().optional(), filePath: z.string().trim().max(512, "File path cannot exceed 512 characters.").optional() });
type Values = z.infer<typeof schema>;
type WorkspaceFile = { id?: string; path: string; content: string; language: SnippetLanguage };
type RelatedSnippetUpdate = { id: string; payload: SnippetInput };

const languageForPath = (path: string, fallback: SnippetLanguage): SnippetLanguage => {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({ html: "html", htm: "html", css: "css", scss: "scss", js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", json: "json", md: "markdown", yml: "yaml", yaml: "yaml", xml: "xml" } as Record<string, SnippetLanguage>)[extension ?? ""] ?? fallback;
};
const fileIcon = (path: string) => {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "css" || extension === "scss") return Palette;
  if (extension === "json") return FileJson2;
  if (["js", "ts", "jsx", "tsx"].includes(extension ?? "")) return Braces;
  if (["html", "xml"].includes(extension ?? "")) return FileCode2;
  return FileText;
};

export function SnippetForm({ formId, snippet, isSubmitting, onEditorFullscreenChange, onSubmit }: { formId: string; snippet?: Snippet; isSubmitting: boolean; onEditorFullscreenChange: (isFullscreen: boolean) => void; onSubmit: (input: SnippetInput, relatedUpdates: RelatedSnippetUpdate[]) => void | Promise<void>; }) {
  const { data: projects } = useProjects({ limit: 100, sort: "name", order: "asc" });
  const { control, formState: { errors, isDirty }, register, watch, handleSubmit, setValue } = useForm<Values>({ defaultValues: { title: snippet?.title ?? "", description: snippet?.description ?? "", language: snippet?.language ?? "typescript", code: snippet?.code ?? "", projectId: snippet?.projectId ?? "", filePath: snippet?.filePath ?? "" }, resolver: zodResolver(schema) });
  const language = watch("language"), projectId = watch("projectId"), filePath = watch("filePath"), primaryCode = watch("code");
  const projectSnippets = useSnippets({ projectId: projectId ?? "", limit: 100, sort: "title", order: "asc" }, Boolean(projectId));
  const [activeFilePath, setActiveFilePath] = useState(snippet?.filePath || (snippet?.language === "html" ? "index.html" : "index.js"));
  const [fileContents, setFileContents] = useState<Record<string, WorkspaceFile>>({});
  const nodeExecution = useRunExecution(); const preview = usePreview(); const [stdin, setStdin] = useState(""); const [timeoutMs, setTimeoutMs] = useState(10000); const [runtime, setRuntime] = useState<ExecutionRuntime>("node");
  const primaryPath = filePath?.trim() || (language === "html" ? "index.html" : "index.js");

  useEffect(() => { nodeExecution.clear(); preview.clear(); if (language === "html") setRuntime("browser"); }, [language]);
  useEffect(() => { setActiveFilePath(primaryPath); setFileContents({ [primaryPath]: { id: snippet?.id, path: primaryPath, content: primaryCode, language } }); }, [snippet?.id]);
  useEffect(() => { setActiveFilePath(primaryPath); setFileContents({ [primaryPath]: { id: snippet?.id, path: primaryPath, content: primaryCode, language: languageForPath(primaryPath, language) } }); }, [projectId]);
  useEffect(() => {
    if (!projectId) return;
    setFileContents((current) => {
      const next = { ...current };
      for (const item of projectSnippets.data?.snippets ?? []) {
        const path = item.filePath || item.title;
        if (!next[path]) next[path] = { id: item.id, path, content: item.id === snippet?.id ? primaryCode : item.code, language: languageForPath(path, item.language) };
      }
      if (!next[primaryPath]) next[primaryPath] = { id: snippet?.id, path: primaryPath, content: primaryCode, language };
      return next;
    });
  }, [projectId, projectSnippets.data?.snippets, snippet?.id]);
  useEffect(() => { setFileContents((current) => ({ ...current, [primaryPath]: { ...(current[primaryPath] ?? { id: snippet?.id, path: primaryPath, language }), id: snippet?.id, path: primaryPath, content: primaryCode, language: languageForPath(primaryPath, language) } })); }, [primaryPath, primaryCode, language, snippet?.id]);

  const files = useMemo(() => Object.values(fileContents).sort((a, b) => a.path.localeCompare(b.path)), [fileContents]);
  const activeFile = fileContents[activeFilePath] ?? { id: snippet?.id, path: primaryPath, content: primaryCode, language: languageForPath(primaryPath, language) };
  const projectEntryPoint = useMemo(
    () => files.find((file) => file.path === "index.html")?.path,
    [files],
  );
  const isBrowserProject = Boolean(projectEntryPoint);
  const selectFile = (path: string) => { setActiveFilePath(path); };
  const updateActiveFile = (content: string) => { setFileContents((current) => ({ ...current, [activeFile.path]: { ...activeFile, content } })); if (activeFile.path === primaryPath) setValue("code", content, { shouldDirty: true }); };
  const run = () => { if (!activeFile.content.trim()) return toast.error("Nothing to run."); if (isBrowserProject) { preview.create({ language: "html", runtime: "browser", entryPoint: projectEntryPoint!, files: files.map(({ path, content }) => ({ path, content })) }); return; } if (language !== "javascript" && language !== "typescript") return toast.error("Only JavaScript and TypeScript can be run with Node.js."); if (projectId) { if (!primaryPath) return toast.error("Project snippets need a file path before they can be run."); if (isDirty) toast.info("Project execution uses saved project files. Save changes to run your edits."); nodeExecution.runProject(projectId, { entryPoint: primaryPath, stdin, timeoutMs }); } else nodeExecution.runStandalone({ language: activeFile.language as "javascript" | "typescript", runtime, framework: runtime, entryPoint: activeFile.path, files: [{ path: activeFile.path, content: activeFile.content }], stdin, timeoutMs }); };
  const languageOptions = languages.map((item) => ({ value: item, label: languageLabels[item] }));
  const projectOptions = [{ value: "", label: "Personal snippet" }, ...(projects?.projects ?? []).map((project) => ({ value: project.id, label: project.name }))];

  return <form className="grid min-h-0 grid-cols-1 overflow-y-auto xl:h-full xl:grid-cols-[minmax(210px,.42fr)_minmax(0,1.2fr)_minmax(320px,.62fr)] xl:overflow-hidden" id={formId} noValidate onSubmit={handleSubmit((values) => { const currentContent = fileContents[primaryPath]?.content ?? values.code; const relatedUpdates = (projectSnippets.data?.snippets ?? []).flatMap((item) => { const path = item.filePath || item.title; const edited = fileContents[path]; if (!edited || edited.id === snippet?.id || edited.content === item.code) return []; return [{ id: item.id, payload: { title: item.title, description: item.description, language: item.language, code: edited.content, projectId: item.projectId, filePath: item.filePath } }]; }); onSubmit({ ...values, code: currentContent, projectId: values.projectId || undefined, filePath: values.projectId ? values.filePath || undefined : null }, relatedUpdates); })}>
    <aside className="min-h-0 overflow-y-auto border-b border-border-subtle bg-elevated p-4 xl:border-r xl:border-b-0"><div className="mb-4 flex items-center gap-2 text-sm font-semibold text-text"><FolderTree className="size-4 text-primary" /> File details</div><div className="space-y-4"><Input autoFocus disabled={isSubmitting} error={errors.title?.message} label="Snippet title" {...register("title")} /><Textarea className="min-h-24 resize-none" disabled={isSubmitting} error={errors.description?.message} label="Description" {...register("description")} /><Controller control={control} name="language" render={({ field }) => <label className="grid gap-2 text-sm font-medium text-text">Language<Select disabled={isSubmitting} onBlur={field.onBlur} onValueChange={(value) => field.onChange(value)} options={languageOptions} value={field.value} /></label>} /><Controller control={control} name="projectId" render={({ field }) => <label className="grid gap-2 text-sm font-medium text-text">Project<Select disabled={isSubmitting} onBlur={field.onBlur} onValueChange={(value) => field.onChange(value)} options={projectOptions} value={field.value || ""} /></label>} />{projectId && <Input disabled={isSubmitting} error={errors.filePath?.message} helperText="Relative to project root" label="File path" placeholder="index.html" {...register("filePath")} />}</div>
      <div className="mt-6 border-t border-border-subtle pt-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{projectId ? "Project files" : "File"}</p><div className="max-h-64 space-y-1 overflow-y-auto pr-1">{files.map((file) => { const Icon = fileIcon(file.path); const active = file.path === activeFile.path; return <button className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${active ? "bg-primary/10 text-primary shadow-[var(--shadow-inset)]" : "text-muted hover:bg-hover hover:text-text"}`} key={file.path} onClick={() => selectFile(file.path)} title={file.path} type="button"><Icon className={`size-4 shrink-0 ${active ? "text-primary" : "text-muted"}`} /><span className="truncate">{file.path}</span></button>; })}</div></div></aside>
    <main className="min-h-[420px] min-w-0 border-b border-border-subtle p-4 xl:min-h-0 xl:border-r xl:border-b-0"><SnippetEditor className="h-full min-h-[390px]" disabled={isSubmitting} error={activeFile.path === primaryPath ? errors.code?.message : undefined} filePath={activeFile.path} language={activeFile.language} onChange={updateActiveFile} onFullscreenChange={onEditorFullscreenChange} value={activeFile.content} /></main>
    <ExecutionOutput isBrowserProject={isBrowserProject} isRunning={isBrowserProject ? preview.isCreating : nodeExecution.isRunning} onClear={() => { nodeExecution.clear(); preview.clear(); }} onPreviewRefresh={run} onRun={run} onRuntimeChange={setRuntime} preview={preview.preview} previewError={preview.error} runLabel={isBrowserProject ? "Preview" : projectId ? "Run project" : "Run"} runtime={runtime} stdin={stdin} onStdinChange={setStdin} onTimeoutChange={setTimeoutMs} state={nodeExecution.state} timeoutMs={timeoutMs} />
  </form>;
}
