// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { LaunchPolicy } from "@prismalens/agent-host";

/**
 * PrismaLens's own secrets: every `PRISMALENS_*` name (the encryption key, the auth and
 * webhook secrets, their `_FILE` forms), plus the telemetry source tokens it reads by name.
 */
export const PRISMALENS_OWN_SECRETS = {
	prefixes: ["PRISMALENS_"],
	names: ["PROMETHEUS_TOKEN", "ALERTMANAGER_TOKEN", "LOKI_TOKEN"],
} as const;

/**
 * The agent gets the user's environment minus PrismaLens's own secrets, GitHub tokens
 * included; `strict` passes only named variables (operator ruling 2026-10-25, #817).
 */
export function prismalensLaunchPolicy(
	opts: { strict?: boolean } = {},
): LaunchPolicy {
	return {
		userSetup: "inherit",
		github: "include",
		floor: opts.strict
			? { mode: "allowlist" }
			: {
					mode: "inherit-minus-own-secrets",
					ownSecrets: PRISMALENS_OWN_SECRETS,
				},
		refuseEnvPrefixes: PRISMALENS_OWN_SECRETS.prefixes,
		refuseEnvNames: PRISMALENS_OWN_SECRETS.names,
	};
}
