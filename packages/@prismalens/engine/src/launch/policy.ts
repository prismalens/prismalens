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

/** Who started the thread: a person, or PrismaLens for an alert or a schedule. */
export type StartedBy = "person" | "alert" | "schedule";

/**
 * A run nobody started by hand reads text anyone can write (alerts), so it gets no
 * GitHub token unless the host allows it; a person's thread keeps it (#1020 R41, #817).
 */
export function githubFor(
	startedBy: StartedBy = "person",
	includeUnattended = false,
): LaunchPolicy["github"] {
	return startedBy === "person" || includeUnattended ? "include" : "exclude";
}

/**
 * The agent gets the user's environment minus PrismaLens's own secrets, GitHub tokens
 * included for a person's thread; `strict` passes only named variables (operator ruling 2026-10-25, #817).
 */
export function prismalensLaunchPolicy(
	opts: {
		strict?: boolean;
		startedBy?: StartedBy;
		/** Settings let alert and schedule runs keep the GitHub token. */
		unattendedGithub?: boolean;
	} = {},
): LaunchPolicy {
	return {
		userSetup: "inherit",
		github: githubFor(opts.startedBy, opts.unattendedGithub),
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
