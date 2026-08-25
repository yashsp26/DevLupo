import { Router } from "express";

import { servePreviewController } from "./preview.controller.js";

const router = Router();

/*
 * ============================================================
 * Public preview content
 * ============================================================
 *
 * No authentication middleware here.
 *
 * The previewId is the capability token.
 */

/*
 * /preview-content/:previewId
 *
 * Serve the default entry point.
 */
router.get("/:previewId", (req, res, next) => {
  req.params.previewPath = "index.html";

  return servePreviewController(req, res, next);
});

/*
 * /preview-content/:previewId/<file>
 *
 * Handles HTML, CSS, JS and nested project files.
 *
 * We intentionally use router.use() instead of:
 *
 *   /:previewId/* 
 *
 * because the installed path-to-regexp version does not
 * support the old unnamed wildcard syntax.
 */
router.use("/:previewId", (req, res, next) => {
  const originalUrl = req.originalUrl.split("?")[0];

  const prefix =
    `/api/v1/execution/preview-content/${req.params.previewId}`;

  let previewPath = originalUrl;

  if (previewPath.startsWith(prefix)) {
    previewPath = previewPath.slice(prefix.length);
  }

  previewPath = previewPath
    .replace(/^\/+/, "")
    .trim();

  req.params.previewPath =
    previewPath || "index.html";

  return servePreviewController(req, res, next);
});

export default router;