/**
 * Base runner contract.
 *
 * JavaScript does not have interfaces like TypeScript,
 * so the execution contract is enforced at runtime.
 */
export class Runner {
  /**
   * Returns true if this runner can execute the request.
   *
   * @param {object} request
   * @returns {boolean}
   */
  canRun(request) {
    throw new Error(
      "Runner must implement canRun().",
    );
  }

  /**
   * Execute the provided code/project.
   *
   * @param {object} request
   * @returns {Promise<object>}
   */
  async run(request) {
    throw new Error(
      "Runner must implement run().",
    );
  }
}