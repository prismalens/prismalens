/**
 * Extension SDK Types
 *
 * Defines the interfaces for PrismaLens extensions.
 * Enterprise extensions implement these types to extend the core application.
 */

import type { ComponentType, ReactNode } from 'react';

/**
 * Edition type for the current deployment.
 */
export type Edition = 'community' | 'enterprise' | 'cloud';

/**
 * Route definition for extension-provided routes.
 */
export interface RouteDefinition {
  path: string;
  component: ComponentType;
  label?: string;
  icon?: ComponentType;
}

/**
 * UI slot locations where extensions can render components.
 */
export interface UISlots {
  layout: {
    'navbar-left': string[];
    'navbar-right': string[];
  };
  settings: {
    tabs: string[];
  };
  dashboard: {
    widgets: string[];
  };
}

/**
 * Extension manifest structure.
 * Loaded from prismalens.extension.json in extension packages.
 */
export interface ExtensionManifest {
  name: string;
  version: string;
  setup: string;
  ui?: {
    views?: Partial<UISlots>;
  };
}

/**
 * Context provided to extensions during setup.
 * Extensions use this to register components and routes.
 */
export interface ExtensionContext {
  /**
   * Register a component that can be rendered in UI slots.
   */
  registerComponent(name: string, component: ComponentType): void;

  /**
   * Define additional routes for the application.
   */
  defineRoutes(routes: RouteDefinition[]): void;

  /**
   * Get the current edition (community, enterprise, cloud).
   */
  getEdition(): Edition;

  /**
   * Check if a feature is available in the current edition.
   */
  hasFeature(feature: string): boolean;
}

/**
 * Extension setup function type.
 */
export type ExtensionSetupFn = (ctx: ExtensionContext) => void | Promise<void>;

/**
 * Extension definition structure.
 */
export interface Extension {
  setup: ExtensionSetupFn;
}

/**
 * Internal extension registry state.
 */
export interface ExtensionRegistry {
  components: Map<string, ComponentType>;
  routes: RouteDefinition[];
  manifest: ExtensionManifest | null;
  edition: Edition;
  loaded: boolean;
}
