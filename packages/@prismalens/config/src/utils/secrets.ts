/**
 * Single source of truth for secret env var names and file naming convention.
 *
 * The _FILE suffix follows Docker/K8s secrets convention:
 * - ENV_VAR: direct value
 * - ENV_VAR_FILE: path to file containing the value
 * - ~/.prismalens/ENV_VAR_FILE: auto-generated default file
 */

export const FILE_SUFFIX = "_FILE" as const;

export const SecretEnvVars = {
	ENCRYPTION_KEY: "PRISMALENS_ENCRYPTION_KEY",
	INTERNAL_SECRET: "PRISMALENS_INTERNAL_SECRET",
	AUTH_SECRET: "PRISMALENS_AUTH_SECRET",
} as const;

export type SecretEnvVar = (typeof SecretEnvVars)[keyof typeof SecretEnvVars];

/** Derive the default filename for a secret env var: e.g. "PRISMALENS_AUTH_SECRET" → "PRISMALENS_AUTH_SECRET_FILE" */
export function secretFileName(envName: SecretEnvVar): string {
	return `${envName}${FILE_SUFFIX}`;
}
