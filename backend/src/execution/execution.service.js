import { NodeRunner } from "./runners/node.runner.js";
import { BrowserRunner } from "./runners/browser.runner.js";

import {
  createExecutionRequest,
  validateExecutionRequest,
} from "./execution.types.js";

const runners = [new NodeRunner(), new BrowserRunner()];

function findRunner(request) {
  return runners.find((runner) => runner.canRun(request));
}

export async function executeCode(input) {
  const request = createExecutionRequest(input);

  validateExecutionRequest(request);

  const runner = findRunner(request);

  if (!runner) {
    throw new Error(
      `No execution runner available for language "${request.language}" with runtime "${request.runtime}".`,
    );
  }

  return runner.run(request);
}

export function getAvailableRunners() {
  return runners.map((runner) => ({
    name: runner.name ?? runner.constructor.name,
  }));
}

/*
 * Used by interactive execution sessions.
 *
 * This keeps runner selection centralized.
 */
export function getExecutionRunner(input) {
  const request = createExecutionRequest(input);

  validateExecutionRequest(request);

  return findRunner(request);
}
