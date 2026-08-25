import { Router } from "express";

import authMiddleware from "../../middleware/auth.middleware.js";
import validate from "../../middleware/validate.middleware.js";

import {
  createPreviewController,
  getPreviewController,
  stopPreviewController,
} from "./preview.controller.js";

import { createPreviewSchema } from "./preview.validation.js";

const router = Router();

/*
 * ============================================================
 * Authentication
 * ============================================================
 */

router.use(authMiddleware);

/*
 * ============================================================
 * Create preview
 * ============================================================
 */

router.post("/", validate(createPreviewSchema), createPreviewController);

/*
 * ============================================================
 * Get preview metadata
 * ============================================================
 */

router.get("/:previewId", getPreviewController);

/*
 * ============================================================
 * Stop preview
 * ============================================================
 */

router.delete("/:previewId", stopPreviewController);

export default router;
