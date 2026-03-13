/**
 * @prismalens/config/integrations
 *
 * Shared integration types — the single source of truth for capability
 * and permission schemas, plus git provider response types.
 *
 * Both `@prismalens/contracts` and `@prismalens/integrations` import from here.
 */
import { z } from "zod";

// =============================================================================
// CAPABILITIES — provider-agnostic action identifiers
// =============================================================================

export const CapabilitySchema = z.enum([
	"vcs:list_orgs",
	"vcs:list_repos",
	"vcs:read_file",
	"vcs:read_commit_status",
	"deployment:list_services",
	"deployment:get_service",
	"deployment:list_deploys",
	"messaging:post",
	"messaging:read",
	"monitoring:read",
]);
export type Capability = z.infer<typeof CapabilitySchema>;

// =============================================================================
// TEMPLATE CATEGORY — type-safe category for discovery strategy dispatch
// =============================================================================

export const TemplateCategorySchema = z.enum([
	"vcs",
	"deployment",
	"messaging",
	"communication",
	"observability",
]);
export type TemplateCategory = z.infer<typeof TemplateCategorySchema>;

// =============================================================================
// PERMISSION REQUIREMENTS — the atomic unit linking provider-specific
// permissions to the capabilities they unlock
// =============================================================================

export const PermissionRequirementSchema = z.object({
	/** Provider-specific permission key (e.g. "contents" for GitHub App, "channels:read" for Slack) */
	key: z.string(),
	/** Permission level — "read" | "write" | "admin" (GitHub App permissions) */
	level: z.string().optional(),
	/** Human-readable explanation of why this permission is needed */
	reason: z.string(),
	/** Capabilities this permission unlocks */
	capabilities: z.array(CapabilitySchema),
});
export type PermissionRequirement = z.infer<typeof PermissionRequirementSchema>;

// =============================================================================
// GIT PROVIDER TYPES — shared across contracts + integrations
// =============================================================================

export const GitOrganizationSchema = z.object({
	id: z.string(),
	name: z.string(),
	displayName: z.string(),
	avatarUrl: z.string().optional(),
	repoCount: z.number().int().optional(),
	description: z.string().optional(),
});
export type GitOrganization = z.infer<typeof GitOrganizationSchema>;

export const GitRepositorySchema = z.object({
	id: z.string(),
	name: z.string(),
	fullName: z.string(),
	description: z.string().optional(),
	language: z.string().optional(),
	stars: z.number().int().optional(),
	defaultBranch: z.string(),
	isPrivate: z.boolean(),
	url: z.string(),
	cloneUrl: z.string().optional(),
	updatedAt: z.string().optional(),
});
export type GitRepository = z.infer<typeof GitRepositorySchema>;

export const GitFileContentSchema = z.object({
	path: z.string(),
	content: z.string(),
	encoding: z.enum(["utf-8", "base64"]),
	sha: z.string().optional(),
	size: z.number(),
});
export type GitFileContent = z.infer<typeof GitFileContentSchema>;

// =============================================================================
// DEPLOYMENT PROVIDER TYPES — shared across contracts + integrations
// =============================================================================

export const DeploymentServiceSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string(), // "web_service", "private_service", "background_worker", "cron_job", "static_site"
	status: z.string(), // "created", "building", "live", "deactivated", "suspended"
	url: z.string().optional(),
	repo: z.string().optional(), // repository URL from the deployment platform
	branch: z.string().optional(),
	region: z.string().optional(),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
});
export type DeploymentService = z.infer<typeof DeploymentServiceSchema>;
