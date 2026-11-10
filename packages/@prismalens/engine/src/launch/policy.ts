// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	GIT_AUTH_VARS,
	GITHUB_TOKEN_VARS,
	type LaunchPolicy,
} from "@prismalens/agent-host";

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
 * The environment floor: a person's thread inherits the user's environment minus
 * PrismaLens's own secrets unless `strict`; an alert's or a schedule's run reads text
 * anyone can write, so it always gets only the named variables (#817).
 */
export function floorFor(
	startedBy: StartedBy = "person",
	strict = false,
	github: LaunchPolicy["github"] = "include",
): LaunchPolicy["floor"] {
	if (!strict && startedBy === "person")
		return {
			mode: "inherit-minus-own-secrets",
			ownSecrets: PRISMALENS_OWN_SECRETS,
		};
	// A person's strict thread keeps named variables only; GitHub's are for an allowed unattended run.
	return github === "include" && startedBy !== "person"
		? {
				mode: "allowlist",
				extraAllow: [...GITHUB_TOKEN_VARS, ...GIT_AUTH_VARS, "GH_CONFIG_DIR"],
			}
		: { mode: "allowlist" };
}

/** A run's launch policy: the floor and GitHub token by who started it (#817, #1020). */
export function prismalensLaunchPolicy(
	opts: {
		strict?: boolean;
		startedBy?: StartedBy;
		/** Settings let alert and schedule runs keep the GitHub token. */
		unattendedGithub?: boolean;
	} = {},
): LaunchPolicy {
	const github = githubFor(opts.startedBy, opts.unattendedGithub);
	return {
		userSetup: "inherit",
		github,
		floor: floorFor(opts.startedBy, opts.strict, github),
		refuseEnvPrefixes: PRISMALENS_OWN_SECRETS.prefixes,
		refuseEnvNames: PRISMALENS_OWN_SECRETS.names,
	};
}
