import { z } from "zod";

export const createPreviewSchema = z.object({
  body: z.object({
    language: z.string().trim().min(1, "Language is required."),

    runtime: z.string().trim().min(1, "Runtime is required."),

    entryPoint: z.string().trim().min(1, "Entry point is required."),

    files: z
      .array(
        z.object({
          path: z.string().trim().min(1, "File path is required."),

          content: z.string(),
        }),
      )
      .min(1, "At least one project file is required."),

    timeoutMs: z.number().int().positive().max(60000).optional(),
  }),

  params: z.object({}),

  query: z.object({}),
});