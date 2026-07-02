/**
 * Deployment schemas
 */
import { z } from "zod";
import { DateStringSchema } from "./common.js";

// =============================================================================
// DEPLOYMENT SCHEMAS
// =============================================================================

export const DeploymentSchema = z.object({
	id: z.string().uuid(),
	serviceId: z.string().uuid().nullable(),
	connectionId: z.string().uuid(),
	externalId: z.string(),
	name: z.string(),
	url: z.string().nullable(),
	status: z.string().nullable(),
	environment: z.string().nullable(),
	deploymentType: z.string().nullable(),
	region: z.string().nullable(),
	branch: z.string().nullable(),
	repositoryUrl: z.string().nullable(),
	metadata: z.record(z.unknown()).nullable(),
	lastDeployedAt: DateStringSchema.nullable(),
	createdAt: DateStringSchema,
	updatedAt: DateStringSchema,
});

export const CreateDeploymentSchema = z.object({
	connectionId: z.string().uuid(),
	externalId: z.string(),
	name: z.string(),
	url: z.string().optional(),
	status: z.string().optional(),
	environment: z.string().optional(),
	deploymentType: z.string().optional(),
	region: z.string().optional(),
	branch: z.string().optional(),
	repositoryUrl: z.string().optional(),
	metadata: z.record(z.unknown()).optional(),
	lastDeployedAt: z.string().datetime().optional(),
});

export const BatchCreateDeploymentsSchema = z.object({
	deployments: z.array(CreateDeploymentSchema).min(1),
});

export const LinkDeploymentSchema = z.object({
	serviceId: z.string().uuid(),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Deployment = z.infer<typeof DeploymentSchema>;
export type CreateDeploymentInput = z.infer<typeof CreateDeploymentSchema>;
export type BatchCreateDeploymentsInput = z.infer<
	typeof BatchCreateDeploymentsSchema
>;
export type LinkDeploymentInput = z.infer<typeof LinkDeploymentSchema>;
