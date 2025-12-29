/**
 * PrismaLens Extension SDK
 *
 * This SDK enables enterprise extensions to extend the core PrismaLens application.
 * Extensions can register components, define routes, and access edition information.
 *
 * @example
 * ```typescript
 * // In @prismalens/web-extensions
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

// Types
export type {
  Edition,
  Extension,
  ExtensionContext,
  ExtensionManifest,
  ExtensionRegistry,
  ExtensionSetupFn,
  RouteDefinition,
  UISlots,
} from './types';

// Definition helpers
export { defineExtension, createSetup } from './define';

// Loader
export { extensionLoader } from './loader';
export type { ExtensionLoader } from './loader';

// Context (internal, but exported for testing)
export { createExtensionContext } from './context';
