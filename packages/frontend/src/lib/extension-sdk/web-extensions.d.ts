/**
 * Type declarations for optional enterprise web extensions package.
 * These modules are only available in enterprise builds.
 */

declare module '@prismalens/web-extensions' {
  import type { Extension } from './types';
  const extension: Extension;
  export default extension;
}

declare module '@prismalens/web-extensions/prismalens.extension.json' {
  import type { ExtensionManifest } from './types';
  const manifest: ExtensionManifest;
  export default manifest;
}
