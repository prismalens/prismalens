// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The environment of every git child (#673): no prompt, no dialog, no inherited
 * trace or config override, English messages for the failure taxonomy, and the
 * credential config that says who authenticates. Pure: no spawn, no Nest.
 */
import { basename } from "node:path";
import { isWsl } from "@prismalens/config";

/** Who authenticates a git call: a saved token, the machine's own git, or nobody. */
export type GitEnvSource = "connection" | "machine" | "none";

export interface GitEnvInput {
	source: GitEnvSource;
	/** `Authorization: Basic …`, for `connection` only. */
	authHeader?: string;
	/** `https://host[:port]` the header is scoped to, for `connection` only. */
	scope?: string;
	/** `git config --get core.sshCommand`, read by the caller. */
	coreSshCommand?: string | null;
	parent?: NodeJS.ProcessEnv;
	wsl?: boolean;
}

const STRIP_EXACT = new Set([
	"GIT_CURL_VERBOSE",
	"GIT_CONFIG_COUNT",
	"GIT_CONFIG_PARAMETERS",
	"GIT_ASKPASS",
	"SSH_ASKPASS",
	"LANGUAGE",
]);
const STRIP_PREFIX = ["GIT_TRACE", "GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"];

function stripped(parent: NodeJS.ProcessEnv): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(parent)) {
		if (value === undefined || STRIP_EXACT.has(key)) continue;
		if (STRIP_PREFIX.some((p) => key.startsWith(p))) continue;
		env[key] = value;
	}
	return env;
}

/** `GIT_SSH_COMMAND` with BatchMode for OpenSSH; any other client is left as it is. */
export function sshCommandFor(
	parent: NodeJS.ProcessEnv,
	coreSshCommand?: string | null,
): string | undefined {
	if (parent.GIT_SSH) return parent.GIT_SSH_COMMAND;
	const base =
		parent.GIT_SSH_COMMAND?.trim() || coreSshCommand?.trim() || "ssh";
	const first = base.split(/\s+/)[0] ?? "";
	return basename(first) === "ssh"
		? `${base} -o BatchMode=yes -o ConnectTimeout=15`
		: base;
}

/** The credential config pairs, by source. */
export function gitConfigPairs(
	input: Pick<GitEnvInput, "source" | "authHeader" | "scope">,
): [string, string][] {
	if (input.source === "machine") return [];
	const pairs: [string, string][] = [["credential.helper", ""]];
	if (input.source === "connection" && input.authHeader && input.scope)
		pairs.push(
			["http.extraheader", ""],
			[
				`http.${input.scope.replace(/\/+$/, "")}/.extraheader`,
				input.authHeader,
			],
		);
	return pairs;
}

export function gitEnv(input: GitEnvInput): Record<string, string> {
	const parent = input.parent ?? process.env;
	const env = stripped(parent);
	Object.assign(env, {
		GIT_TERMINAL_PROMPT: "0",
		// Set but empty: git sees an askpass and runs nothing (an IDE terminal's would hang a 401).
		GIT_ASKPASS: "",
		SSH_ASKPASS_REQUIRE: "never",
		GCM_INTERACTIVE: "never",
		GIT_TRACE_REDACT: "1",
		LC_ALL: "C",
	});
	if (input.wsl ?? isWsl(parent))
		env.WSLENV = parent.WSLENV
			? `${parent.WSLENV}:GCM_INTERACTIVE`
			: "GCM_INTERACTIVE";
	const ssh = sshCommandFor(parent, input.coreSshCommand);
	if (ssh === undefined) delete env.GIT_SSH_COMMAND;
	else env.GIT_SSH_COMMAND = ssh;
	const pairs = gitConfigPairs(input);
	if (pairs.length) {
		env.GIT_CONFIG_COUNT = String(pairs.length);
		pairs.forEach(([key, value], i) => {
			env[`GIT_CONFIG_KEY_${i}`] = key;
			env[`GIT_CONFIG_VALUE_${i}`] = value;
		});
	}
	return env;
}
