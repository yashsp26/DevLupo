import { Router } from "express";

import authMiddleware from "../middleware/auth.middleware.js";
import validate from "../middleware/validate.middleware.js";

import {
  createExecutionSessionController,
} from "./execution-session.controller.js";

import {
  createExecutionSessionSchema,
} from "./execution-session.validation.js";

const router = Router();

router.use(authMiddleware);

router.post(
  "/",
  validate(createExecutionSessionSchema),
  createExecutionSessionController,
);

export default router;