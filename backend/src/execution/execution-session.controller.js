import {
  createExecutionSession,
} from "./execution-session.manager.js";

export async function createExecutionSessionController(
  req,
  res,
  next,
) {
  try {
    const session =
      await createExecutionSession({
        userId: req.user.id,
        request: req.validatedData,
      });

    return res.status(201).json({
      success: true,
      data: {
        sessionId: session.id,
        status: session.status,
      },
    });
  } catch (error) {
    next(error);
  }
}