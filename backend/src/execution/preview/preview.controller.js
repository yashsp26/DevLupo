import asyncHandler from "../../utils/asyncHandler.js";

import {
  createPreview,
  getPreview,
  stopPreview,
  servePreviewRequest,
} from "./preview.service.js";

/*
 * ============================================================
 * Create preview
 * ============================================================
 */

export const createPreviewController = asyncHandler(async (req, res) => {
  const preview = await createPreview({
    userId: req.user.id,
    request: req.validatedData,
  });

  res.status(201).json({
    success: true,
    data: preview,
  });
});

/*
 * ============================================================
 * Get preview metadata
 * ============================================================
 */

export const getPreviewController = asyncHandler(async (req, res) => {
  const preview = getPreview(
    req.user.id,
    req.params.previewId,
  );

  res.status(200).json({
    success: true,
    data: preview,
  });
});

/*
 * ============================================================
 * Stop preview
 * ============================================================
 */

export const stopPreviewController = asyncHandler(async (req, res) => {
  await stopPreview(req.params.previewId);

  res.status(200).json({
    success: true,
    message: "Preview stopped successfully.",
  });
});

/*
 * ============================================================
 * Serve preview files
 * ============================================================
 *
 * IMPORTANT:
 *
 * This endpoint intentionally does NOT use req.user.
 *
 * The previewId itself is the capability token.
 */

export const servePreviewController = asyncHandler(
  async (req, res) => {
    const previewPath =
      Array.isArray(req.params.previewPath)
        ? req.params.previewPath.join("/")
        : req.params.previewPath || "index.html";

    await servePreviewRequest(
      req.params.previewId,
      previewPath,
      res,
    );
  },
);