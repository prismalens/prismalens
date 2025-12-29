/**
 * Extension Definition
 *
 * Type-safe wrapper for defining extensions.
 * Used by enterprise extension packages.
 */

import type { Extension, ExtensionSetupFn } from './types';

/**
 * Define a PrismaLens extension.
 *
 * This is the main entry point for extension packages.
 * It provides type safety and validates the extension structure.
 *
 * @example
 * ```typescript
 * import { defineExtension } from '@prismalens/extension-sdk';
 *
 * export default defineExtension({
 *   setup(ctx) {
 *     ctx.registerComponent('WorkspaceSwitcher', WorkspaceSwitcher);
 *     ctx.defineRoutes([
 *       { path: '/settings/team', component: TeamManagement },
 *     ]);
 *   }
 * });
 * ```
 */
export function defineExtension(extension: Extension): Extension {
  if (typeof extension.setup !== 'function') {
    throw new Error('Extension must have a setup function');
  }
  return extension;
}

/**
 * Create an extension setup function directly.
 *
 * Alternative to defineExtension for simpler cases.
 *
 * @example
 * ```typescript
 * import { createSetup } from '@prismalens/extension-sdk';
 *
 * export const setup = createSetup((ctx) => {
 *   ctx.registerComponent('MyComponent', MyComponent);
 * });
 * ```
 */
export function createSetup(fn: ExtensionSetupFn): ExtensionSetupFn {
  return fn;
}
