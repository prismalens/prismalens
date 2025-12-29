/**
 * Extension Loader
 *
 * Singleton that manages loading and registering extensions.
 * Mirrors the Python extension_loader.py pattern.
 *
 * At build time:
 * - Community: @prismalens/web-extensions not found, runs in community mode
 * - Enterprise: @prismalens/web-extensions found, loads extensions
 */

import type { ComponentType } from 'react';
import type {
  Edition,
  Extension,
  ExtensionManifest,
  ExtensionRegistry,
  RouteDefinition,
} from './types';
import { createExtensionContext } from './context';

/**
 * Singleton extension loader.
 */
class ExtensionLoader {
  private static instance: ExtensionLoader | null = null;

  private registry: ExtensionRegistry = {
    components: new Map(),
    routes: [],
    manifest: null,
    edition: 'community',
    loaded: false,
  };

  private constructor() {
    // Determine edition from environment
    this.registry.edition = this.detectEdition();
  }

  /**
   * Get the singleton instance.
   */
  static getInstance(): ExtensionLoader {
    if (!ExtensionLoader.instance) {
      ExtensionLoader.instance = new ExtensionLoader();
    }
    return ExtensionLoader.instance;
  }

  /**
   * Detect the current edition from environment variables.
   */
  private detectEdition(): Edition {
    const envEdition = process.env.NEXT_PUBLIC_PRISMALENS_EDITION;
    if (envEdition === 'enterprise' || envEdition === 'cloud') {
      return envEdition;
    }
    return 'community';
  }

  /**
   * Load extensions from the enterprise package.
   *
   * @returns true if enterprise extensions were loaded
   */
  async loadExtensions(): Promise<boolean> {
    if (this.registry.loaded) {
      console.debug('[ExtensionLoader] Extensions already loaded');
      return this.registry.edition !== 'community';
    }

    this.registry.loaded = true;

    try {
      // Try to import the enterprise extensions package
      // This is resolved at build time - if not found, it throws
      const extensionModule = await import('@prismalens/web-extensions');

      // Load manifest if available
      try {
        const manifest = await import(
          '@prismalens/web-extensions/prismalens.extension.json'
        );
        this.registry.manifest = manifest.default || manifest;
        console.debug(
          `[ExtensionLoader] Loaded manifest: ${this.registry.manifest?.name}`
        );
      } catch {
        console.debug('[ExtensionLoader] No manifest found, using defaults');
      }

      // Create context and run setup
      const ctx = createExtensionContext(this.registry);
      const extension: Extension = extensionModule.default || extensionModule;

      if (extension.setup) {
        await extension.setup(ctx);
        console.info(
          `[ExtensionLoader] Enterprise extensions loaded (${this.registry.components.size} components, ${this.registry.routes.length} routes)`
        );
      }

      return true;
    } catch (error) {
      // Module not found - running in community mode
      if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
        console.info(
          '[ExtensionLoader] Running in Community Edition mode (@prismalens/web-extensions not found)'
        );
      } else {
        console.error('[ExtensionLoader] Error loading extensions:', error);
      }
      return false;
    }
  }

  /**
   * Check if enterprise features are available.
   */
  get isEnterprise(): boolean {
    return this.registry.edition !== 'community';
  }

  /**
   * Get the current edition.
   */
  get edition(): Edition {
    return this.registry.edition;
  }

  /**
   * Get a registered component by name.
   */
  getComponent(name: string): ComponentType | undefined {
    return this.registry.components.get(name);
  }

  /**
   * Get all registered components.
   */
  getAllComponents(): Map<string, ComponentType> {
    return new Map(this.registry.components);
  }

  /**
   * Get components for a specific UI slot.
   */
  getSlotComponents(view: string, slot: string): ComponentType[] {
    if (!this.registry.manifest?.ui?.views) {
      return [];
    }

    const viewConfig = this.registry.manifest.ui.views[
      view as keyof typeof this.registry.manifest.ui.views
    ] as Record<string, string[]> | undefined;

    if (!viewConfig || !viewConfig[slot]) {
      return [];
    }

    return viewConfig[slot]
      .map((name) => this.registry.components.get(name))
      .filter((c): c is ComponentType => c !== undefined);
  }

  /**
   * Get all registered routes.
   */
  getRoutes(): RouteDefinition[] {
    return [...this.registry.routes];
  }

  /**
   * Get the loaded manifest.
   */
  getManifest(): ExtensionManifest | null {
    return this.registry.manifest;
  }

  /**
   * Check if extensions have been loaded.
   */
  get isLoaded(): boolean {
    return this.registry.loaded;
  }
}

// Export singleton instance
export const extensionLoader = ExtensionLoader.getInstance();

// Export type for external use
export type { ExtensionLoader };
