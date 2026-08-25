import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { snippetApi } from "../api/snippet.api";
import { queryClient } from "../lib/queryClient";
import type {
  Snippet,
  SnippetListParams,
  SnippetListResponse,
} from "../types/snippet";
import { getApiErrorMessage } from "../utils/apiError";

export const snippetQueryKeys = {
  all: ["snippets"] as const,
  lists: () => [...snippetQueryKeys.all, "list"] as const,
  list: (params: SnippetListParams) =>
    [...snippetQueryKeys.lists(), params] as const,
  detail: (id: string) => [...snippetQueryKeys.all, "detail", id] as const,
};
const updateInLists = (snippet: Snippet) =>
  queryClient.setQueriesData<SnippetListResponse>(
    { queryKey: snippetQueryKeys.lists() },
    (list) =>
      list && {
        ...list,
        snippets: list.snippets.map((item) =>
          item.id === snippet.id ? snippet : item,
        ),
      },
  );
const invalidate = (id?: string) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: snippetQueryKeys.lists() }),
    ...(id
      ? [
          queryClient.invalidateQueries({
            queryKey: snippetQueryKeys.detail(id),
          }),
        ]
      : []),
  ]);

export function useSnippets(params: SnippetListParams, enabled = true) {
  return useQuery({
    queryKey: snippetQueryKeys.list(params),
    queryFn: () => snippetApi.getSnippets(params),
    enabled,
  });
}
export function useSnippet(id: string | undefined) {
  return useQuery({
    queryKey: snippetQueryKeys.detail(id ?? ""),
    queryFn: () => snippetApi.getSnippet(id!),
    enabled: Boolean(id),
  });
}
export function useCreateSnippet() {
  return useMutation({
    mutationFn: snippetApi.createSnippet,
    onSuccess: async () => {
      await invalidate();
      toast.success("Snippet created.");
    },
    onError: (e) =>
      toast.error(
        getApiErrorMessage(
          e,
          "Unable to create the snippet. Please try again.",
        ),
      ),
  });
}
export function useUpdateSnippet() {
  return useMutation({
    mutationFn: snippetApi.updateSnippet,
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey: snippetQueryKeys.lists() });
      const previous = queryClient.getQueriesData<SnippetListResponse>({
        queryKey: snippetQueryKeys.lists(),
      });
      queryClient.setQueriesData<SnippetListResponse>(
        { queryKey: snippetQueryKeys.lists() },
        (list) =>
          list && {
            ...list,
            snippets: list.snippets.map((item) =>
              item.id === id ? { ...item, ...payload } : item,
            ),
          },
      );
      return { previous };
    },
    onError: (e, _v, context) => {
      context?.previous.forEach(([key, data]) =>
        queryClient.setQueryData(key, data),
      );
      toast.error(
        getApiErrorMessage(
          e,
          "Unable to update the snippet. Please try again.",
        ),
      );
    },
    onSuccess: (snippet) => {
      queryClient.setQueryData(snippetQueryKeys.detail(snippet.id), snippet);
      updateInLists(snippet);
      toast.success("Snippet updated.");
    },
    onSettled: async (_d, _e, { id }) => {
      await invalidate(id);
    },
  });
}
export function useDeleteSnippet() {
  return useMutation({
    mutationFn: snippetApi.deleteSnippet,
    onSuccess: async (_d, id) => {
      queryClient.removeQueries({ queryKey: snippetQueryKeys.detail(id) });
      await invalidate();
      toast.success("Snippet deleted.");
    },
    onError: (e) =>
      toast.error(
        getApiErrorMessage(
          e,
          "Unable to delete the snippet. Please try again.",
        ),
      ),
  });
}
export function useToggleSnippetFavorite() {
  return useMutation({
    mutationFn: snippetApi.toggleFavorite,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: snippetQueryKeys.lists() });
      const previous = queryClient.getQueriesData<SnippetListResponse>({
        queryKey: snippetQueryKeys.lists(),
      });
      queryClient.setQueriesData<SnippetListResponse>(
        { queryKey: snippetQueryKeys.lists() },
        (list) =>
          list && {
            ...list,
            snippets: list.snippets.map((item) =>
              item.id === id ? { ...item, isFavorite: !item.isFavorite } : item,
            ),
          },
      );
      return { previous };
    },
    onError: (e, _id, context) => {
      context?.previous.forEach(([key, data]) =>
        queryClient.setQueryData(key, data),
      );
      toast.error(
        getApiErrorMessage(
          e,
          "Unable to update the snippet favorite. Please try again.",
        ),
      );
    },
    onSuccess: (snippet) => {
      queryClient.setQueryData(snippetQueryKeys.detail(snippet.id), snippet);
      updateInLists(snippet);
      toast.success("Snippet favorite updated.");
    },
    onSettled: async (_d, _e, id) => {
      await invalidate(id);
    },
  });
}
