import { z } from "zod";

const filePathSchema = z
  .string()
  .trim()
  .min(1, "File path is required.")
  .max(512, "File path cannot exceed 512 characters.")
  .superRefine((value, ctx) => {
    if (value.includes("\0")) {
      ctx.addIssue({
        code: "custom",
        message: "File path cannot contain null bytes.",
      });
    }

    if (
      value.startsWith("/") ||
      value.startsWith("\\") ||
      /^[a-zA-Z]:/.test(value)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "File path must be relative to the execution root.",
      });
    }

    if (value.includes("\\")) {
      ctx.addIssue({
        code: "custom",
        message: "File path must use forward slashes.",
      });
    }

    const segments = value.split("/");

    if (
      segments.some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === "..",
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "File path contains an invalid path segment.",
      });
    }
  });

const executionFileSchema = z.object({
  path: filePathSchema,

  content: z.string(),
});

const baseExecutionFields = {
  language: z
    .string()
    .trim()
    .min(1, "Language is required."),

  runtime: z
    .string()
    .trim()
    .optional()
    .default("node"),

  framework: z
    .string()
    .trim()
    .optional(),

  entryPoint: z
    .string()
    .trim()
    .min(1, "Entry point is required.")
    .default("index.js"),

  files: z
    .array(executionFileSchema)
    .min(1, "At least one file is required.")
    .max(100, "A maximum of 100 files can be executed."),

  stdin: z
    .string()
    .max(100_000, "Input cannot exceed 100 KB.")
    .optional()
    .default(""),

  timeoutMs: z
    .number()
    .int()
    .min(1000, "Minimum timeout is 1 second.")
    .max(30000, "Maximum timeout is 30 seconds.")
    .optional()
    .default(10000),
};

export const runCodeSchema = z.object({
  body: z.object(baseExecutionFields),

  params: z.object({}),

  query: z.object({}),
});

export const runProjectSchema = z.object({
  body: z.object({
    entryPoint: filePathSchema.optional(),

    stdin: z
      .string()
      .max(100_000, "Input cannot exceed 100 KB.")
      .optional()
      .default(""),

    timeoutMs: z
      .number()
      .int()
      .min(1000, "Minimum timeout is 1 second.")
      .max(30000, "Maximum timeout is 30 seconds.")
      .optional()
      .default(10000),
  }),

  params: z.object({
    projectId: z.string().cuid(),
  }),

  query: z.object({}),
});