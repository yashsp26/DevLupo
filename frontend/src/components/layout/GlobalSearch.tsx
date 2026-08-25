import {
  Code2,
  FileText,
  FolderKanban,
  ListTodo,
  Search,
  Tag,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useSearch } from "../../services/useSearch";
import type { SearchResult, SearchType } from "../../types/search";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { Spinner } from "../ui/Spinner";

const groups: Array<{
  key: SearchResult["type"];
  label: string;
  icon: LucideIcon;
}> = [
  { key: "project", label: "Projects", icon: FolderKanban },
  { key: "task", label: "Tasks", icon: ListTodo },
  { key: "note", label: "Notes", icon: FileText },
  { key: "snippet", label: "Snippets", icon: Code2 },
  { key: "label", label: "Labels", icon: Tag },
];

const filterOptions: Array<{ label: string; value: SearchType }> = [
  { label: "All", value: "all" },
  { label: "Projects", value: "projects" },
  { label: "Tasks", value: "tasks" },
  { label: "Notes", value: "notes" },
  { label: "Snippets", value: "snippets" },
  { label: "Labels", value: "labels" },
];

function getResultTitle(result: SearchResult) {
  return result.type === "project" || result.type === "label"
    ? result.name
    : result.title;
}

function getProject(result: SearchResult) {
  return result.type === "project"
    ? { color: result.color, name: result.name }
    : result.project;
}

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<SearchType>("all");
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const trimmedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(trimmedQuery);
  const { data, isError, isFetching } = useSearch(debouncedQuery, type);
  const navigate = useNavigate();
  const canSearch = trimmedQuery.length >= 2 && debouncedQuery.length >= 2;
  const showResults = isOpen && canSearch;
  const flatResults = groups.flatMap(
    ({ key }) => data?.results.filter((result) => result.type === key) ?? [],
  );

  useEffect(() => {
    setHighlightedIndex(flatResults.length ? 0 : -1);
  }, [debouncedQuery, type, flatResults.length]);

  useEffect(() => {
    if (isError) toast.error("Search is unavailable. Please try again.");
  }, [isError]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) close();
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [isOpen]);

  const close = (restoreMobileFocus = false) => {
    setIsOpen(false);
    setIsMobileOpen(false);
    setHighlightedIndex(-1);
    if (restoreMobileFocus) requestAnimationFrame(() => mobileTriggerRef.current?.focus());
  };

  const openResult = (result: SearchResult) => {
    if (result.type === "project") navigate(`/projects/${result.id}`);
    else if (result.type === "task")
      navigate(`/projects/${result.project.id}/tasks?task=${result.id}`);
    else if (result.type === "label")
      navigate(`/projects/${result.project.id}`);
    else if (result.type === "note") navigate("/notes");
    else navigate("/snippets");
    setQuery("");
    close();
  };

  const searchField = (mobile = false) => (
    <div className="relative" role="search">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
      />
      <input
        aria-label="Search DevLupo"
        className="neu-inset min-h-10 w-full appearance-none rounded-xl border border-transparent bg-surface-input py-2 pl-9 pr-11 text-sm text-text outline-none transition placeholder:text-muted/65 focus:border-primary focus:ring-2 focus:ring-primary/25 [&::-webkit-search-cancel-button]:appearance-none"
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setIsOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.currentTarget.blur();
            close(mobile);
          }
          if (!flatResults.length) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlightedIndex((index) => (index + 1) % flatResults.length);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlightedIndex(
              (index) => (index - 1 + flatResults.length) % flatResults.length,
            );
          }
          if (event.key === "Enter" && highlightedIndex >= 0) {
            event.preventDefault();
            openResult(flatResults[highlightedIndex]);
          }
        }}
        placeholder="Search DevLupo..."
        type="search"
        value={query}
      />
      {(query || mobile) && (
        <button
          aria-label="Close search"
          className="neu-raised absolute right-1 top-1/2 flex size-10 shrink-0 -translate-y-1/2 items-center justify-center rounded-xl bg-elevated text-muted transition-[background-color,color,box-shadow] hover:bg-primary/10 hover:text-text active:shadow-[var(--shadow-inset)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={() => {
            setQuery("");
            close(mobile);
          }}
          onMouseDown={(event) => event.preventDefault()}
          type="button"
        >
          <X aria-hidden="true" className="size-4 shrink-0" />
        </button>
      )}
      {showResults && (
        <div
          className={`neu-raised-lg absolute z-50 mt-2 max-w-[calc(100vw-2rem)] overflow-visible rounded-2xl border border-border/70 bg-elevated ${mobile ? "right-0 w-[min(22rem,calc(100vw-2rem))]" : "right-0 w-96"}`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
            <Select
              aria-label="Filter search results"
              className="w-32"
              onValueChange={(value) => setType(value as SearchType)}
              options={filterOptions}
              size="sm"
              value={type}
            />
            {type === "all" && data && (
              <div className="flex flex-wrap justify-end gap-x-2 text-xs text-muted">
                <span>Projects {data.counts.projects}</span>
                <span>Tasks {data.counts.tasks}</span>
                <span>Notes {data.counts.notes}</span>
                <span>Snippets {data.counts.snippets}</span>
                <span>Labels {data.counts.labels}</span>
              </div>
            )}
          </div>
          {isFetching ? (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted">
              <Spinner className="size-4" label="Searching" />
              Searching…
            </div>
          ) : isError ? (
            <p className="px-4 py-3 text-sm text-muted">
              Search is unavailable. Please try again.
            </p>
          ) : data?.results.length ? (
            <div className="max-h-[min(70vh,32rem)] overflow-y-auto py-2">
              {groups.map(({ icon: Icon, key, label }) => {
                const results = data.results.filter(
                  (result) => result.type === key,
                );
                return results.length ? (
                  <section key={key}>
                    <h2 className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      {label}
                    </h2>
                    {results.map((result) => {
                      const project = getProject(result);
                      const resultIndex = flatResults.indexOf(result);
                      return (
                        <button
                          aria-selected={highlightedIndex === resultIndex}
                          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary ${highlightedIndex === resultIndex ? "bg-primary/15" : "hover:bg-primary/8"}`}
                          key={result.id}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => openResult(result)}
                          type="button"
                        >
                          <Icon
                            aria-hidden="true"
                            className="size-4 shrink-0 text-primary"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-text">
                                {getResultTitle(result)}
                              </span>
                              {result.type === "snippet" && (
                                <Badge variant="primary">
                                  {result.language}
                                </Badge>
                              )}
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                              <span className="capitalize">{result.type}</span>
                              {project && (
                                <>
                                  <span>·</span>
                                  <span
                                    aria-label={`${project.name} project color`}
                                    className="size-2 shrink-0 rounded-full"
                                    style={{
                                      backgroundColor:
                                        project.color ?? "var(--color-primary)",
                                    }}
                                  />
                                  <span className="truncate">
                                    {project.name}
                                  </span>
                                </>
                              )}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </section>
                ) : null;
              })}
            </div>
          ) : (
            <div className="px-4 py-4 text-sm text-muted">
              <p className="font-medium text-text">No results found</p>
              <p className="mt-1">Try a different search term.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="relative" ref={searchRef}>
      <div className="hidden w-72 md:block">{searchField()}</div>
      <div className="md:hidden">
        <Button
          aria-label="Search DevLupo"
          onClick={() => {
            const next = !isMobileOpen;
            setIsMobileOpen(next);
            setIsOpen(next);
          }}
          size="icon"
          ref={mobileTriggerRef}
          variant="ghost"
        >
          <Search aria-hidden="true" className="size-4" />
        </Button>
        {isMobileOpen && (
          <div className="fixed inset-x-4 top-[5.5rem] z-50">
            {searchField(true)}
          </div>
        )}
      </div>
    </div>
  );
}
