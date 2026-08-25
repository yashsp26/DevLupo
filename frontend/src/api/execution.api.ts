import { apiClient } from "./client";
import type { ExecutionResult, PreviewInfo, PreviewRequest, RunCodeRequest, RunProjectRequest } from "../types/execution";

type ApiResponse<T> = {
  data: T;
  success: boolean;
};

export const executionApi = {
  async runCode(payload: RunCodeRequest) {
    const { data } = await apiClient.post<ApiResponse<ExecutionResult>>(
      "/v1/execution/run",
      payload,
    );
    return data.data;
  },
  async runProject(projectId: string, payload: RunProjectRequest) {
    const { data } = await apiClient.post<ApiResponse<ExecutionResult>>(
      `/v1/execution/projects/${projectId}/run`,
      payload,
    );
    return data.data;
  },
  async createPreview(payload: PreviewRequest) {
    const { data } = await apiClient.post<ApiResponse<PreviewInfo>>(
      "/v1/execution/preview",
      payload,
    );
    return data.data;
  },
  async stopPreview(previewId: string) {
    await apiClient.delete(`/v1/execution/preview/${previewId}`);
  },
};
