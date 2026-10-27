/**
 * Error types for the plugin SDK.
 */

/** Thrown by `definePlugin` when a definition is structurally invalid. */
export class PluginValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginValidationError';
  }
}
