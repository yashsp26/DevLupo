import { executeCode } from "./execution.service.js";
import { executeProject } from "./project-execution.service.js";

export async function runCode(req, res, next) {
  try {
    const result = await executeCode(
      req.validatedData,
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function runProject(req, res, next) {
  try {
    const result = await executeProject(
      req.user.id,
      req.params.projectId,
      req.validatedData,
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}