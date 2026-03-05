/**
 * @prismalens/config/integrations
 *
 * Integration display configuration (SSOT).
 * Browser-safe: no Node.js dependencies.
 *
 * Keeps UI/product concerns (which integrations to feature)
 * separate from auth concerns (AuthTemplate in @prismalens/integrations).
 *
 * @example
 * ```typescript
 * import { FEATURED_TEMPLATE_IDS } from '@prismalens/config/integrations';
 * ```
 */

/**
 * Template IDs shown in the setup wizard and "recommended" lists.
 * Order determines display order.
 */
export const FEATURED_TEMPLATE_IDS = [
	"github-oauth2",
	"prometheus",
	"slack",
] as const;

export type FeaturedTemplateId = (typeof FEATURED_TEMPLATE_IDS)[number];
