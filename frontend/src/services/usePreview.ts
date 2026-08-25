import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { executionApi } from "../api/execution.api";
import type { PreviewInfo, PreviewRequest } from "../types/execution";
import { getApiErrorMessage } from "../utils/apiError";

export function usePreview() {
  const previewIdRef = useRef<string | undefined>(undefined);
  const [preview, setPreview] = useState<PreviewInfo>();
  const mutation = useMutation({
    mutationFn: executionApi.createPreview,
    onSuccess: (nextPreview) => {
      const previousPreviewId = previewIdRef.current;
      previewIdRef.current = nextPreview.id;
      setPreview(nextPreview);
      if (previousPreviewId && previousPreviewId !== nextPreview.id) {
        void executionApi.stopPreview(previousPreviewId).catch(() => undefined);
      }
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Unable to create the preview. Please try again.")),
  });

  const clear = useCallback(() => {
    const previewId = previewIdRef.current;
    previewIdRef.current = undefined;
    setPreview(undefined);
    if (previewId) {
      void executionApi.stopPreview(previewId).catch(() => undefined);
    }
  }, []);

  useEffect(() => clear, [clear]);

  return {
    clear,
    create: (request: PreviewRequest) => mutation.mutate(request),
    error: mutation.error ? getApiErrorMessage(mutation.error, "Unable to create the preview.") : undefined,
    isCreating: mutation.isPending,
    preview,
  };
}
