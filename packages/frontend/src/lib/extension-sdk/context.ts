/**
 * Extension Context Implementation
 *
 * Provides the runtime context for extensions to register
 * components, routes, and access edition information.
 */

import type { ComponentType } from 'react';
import type {
  Edition,
  ExtensionContext,
  ExtensionRegistry,
  RouteDefinition,
} from './types';

/**
 * Enterprise features available by edition.
 */
const EDITION_FEATURES: Record<Edition, string[]> = {
  community: [],
  enterprise: [
    'sso',
    'teams',
    'audit-logs',
    'priority-support',
    'custom-integrations',
  ],
  cloud: [
    'sso',
    'teams',
    'audit-logs',
    'priority-support',
    'custom-integrations',
    'multi-tenancy',
    'billing',
    'usage-analytics',
  ],
};

/**
 * Create an extension context for the given registry.
 */
export function createExtensionContext(
  registry: ExtensionRegistry
): ExtensionContext {
  return {
    registerComponent(name: string, component: ComponentType): void {
      if (registry.components.has(name)) {
        console.warn(
          `[ExtensionSDK] Component "${name}" is already registered, overwriting.`
        );
      }
      registry.components.set(name, component);
      console.debug(`[ExtensionSDK] Registered component: ${name}`);
    },

    defineRoutes(routes: RouteDefinition[]): void {
      for (const route of routes) {
        // Check for duplicate paths
        const existing = registry.routes.find((r) => r.path === route.path);
        if (existing) {
          console.warn(
            `[ExtensionSDK] Route "${route.path}" is already defined, overwriting.`
          );
          registry.routes = registry.routes.filter((r) => r.path !== route.path);
        }
        registry.routes.push(route);
        console.debug(`[ExtensionSDK] Defined route: ${route.path}`);
      }
    },

    getEdition(): Edition {
      return registry.edition;
    },

    hasFeature(feature: string): boolean {
      const features = EDITION_FEATURES[registry.edition];
      return features.includes(feature);
    },
  };
}
