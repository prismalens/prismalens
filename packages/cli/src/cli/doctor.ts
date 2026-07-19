// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `prismalens doctor` — preflight checklist for the two-tier engine (ADR-0008/0010).
 *
 * Salvaged in spirit from the retired pl orchestrator's doctor, but pared down to the
 * checks that actually gate a run:
 *  - HARD: the configured harness binary is on PATH
 *      (deepagents -> "deepagents", claude-code -> "claude", codex -> "codex")
 *  - HARD: an LLM credential is present
 *      (any provider credential env var from LLM_PROVIDERS, or, for claude-code,
 *       a signed-in ~/.claude/.credentials.json)
 *  - SOFT: workspace.dir is writable
 *
 * Prints pass/fail per check; exits non-zero iff a HARD check fails. No tinyexec /
 * check-tool helper here — availability is a dependency-free PATH scan.
 */
import { accessSync, constants as fsConstants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { resolveCredentials } from "@prismalens/config/credentials";
import { HARNESS_BINARY } from "@prismalens/config/harness";
import {
	AUTO_SELECT_PROVIDER_IDS,
	LLM_PROVIDERS,
	type LLMProviderId,
} from "@prismalens/config/llm";
import { pingModel } from "@prismalens/config/model";
import { defineCommand } from "citty";
import consola from "consola";
import { loadConfig } from "../config/loader.js";
import type { PlConfig } from "../config/schema.js";
import { resolveBaseDir } from "../core/session.js";
import { assertKnownFlags } from "./flags.js";

type Harness = PlConfig["agent"]["default"];

interface Check {
	name: string;
	pass: boolean;
	detail: string;
	hard: boolean;
}

function isOnPath(bin: string): boolean {
	const pathEnv = process.env.PATH ?? "";
	const exts =
		process.platform === "win32"
			? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
			: [""];
	for (const dir of pathEnv.split(delimiter)) {
		if (dir.length === 0) continue;
		for (const ext of exts) {
			try {
				accessSync(join(dir, bin + ext), fsConstants.X_OK);
				return true;
			} catch {
				// keep looking
			}
		}
	}
	return false;
}

function checkHarness(harness: Harness): Check {
	const binary = HARNESS_BINARY[harness];
	const pass = isOnPath(binary);
	return {
		name: "Harness binary",
		pass,
		detail: pass
			? `${binary} found on PATH (harness: ${harness})`
			: `${binary} not found on PATH — install the "${harness}" harness`,
		hard: true,
	};
}

export async function checkCredential(
	config: PlConfig,
	noPing: boolean,
): Promise<Check> {
	let providerId = config.synth.provider;
	let creds: ReturnType<typeof resolveCredentials> | undefined;

	if (providerId) {
		creds = resolveCredentials(providerId, config.synth.base_url);
	} else {
		for (const id of AUTO_SELECT_PROVIDER_IDS) {
			const candidate = resolveCredentials(id, config.synth.base_url);
			if (candidate.source !== "none") {
				providerId = id;
				creds = candidate;
				break;
			}
		}
		if (!creds) {
			creds = { providerId: "ollama", source: "none" };
			providerId = "ollama";
		}
	}

	if (creds.source === "none") {
		return {
			name: "LLM credential",
			pass: false,
			detail: "none (reports will be RAW harness pass-through) — not verified",
			hard: false,
		};
	}

	const providerName = LLM_PROVIDERS[providerId as LLMProviderId].name;

	if (noPing) {
		return {
			name: "LLM credential",
			pass: true,
			detail: `${providerName} (source: ${creds.source}) — ping skipped`,
			hard: false,
		};
	}

	const ping = await pingModel(
		providerId as LLMProviderId,
		config.synth.model,
		{
			apiKey: creds.apiKey,
			baseURL: creds.baseURL,
		},
	);

	if (ping.success) {
		return {
			name: "LLM credential",
			pass: true,
			detail: `${providerName} (source: ${creds.source}) — ping OK`,
			hard: false,
		};
	} else {
		return {
			name: "LLM credential",
			pass: false,
			detail: `${providerName} (source: ${creds.source}) — ping failed: ${ping.error}`,
			hard: true,
		};
	}
}

async function checkWorkspace(config: PlConfig): Promise<Check> {
	const baseDir = resolveBaseDir(config.workspace.dir);
	try {
		await mkdir(baseDir, { recursive: true });
		await access(baseDir, fsConstants.W_OK);
		return {
			name: "Workspace",
			pass: true,
			detail: `${baseDir} is writable`,
			hard: false,
		};
	} catch {
		return {
			name: "Workspace",
			pass: false,
			detail: `${baseDir} is not writable — runs cannot persist here`,
			hard: false,
		};
	}
}

export function checkListenToken(config: PlConfig): Check {
	if (config.listen.token) {
		return {
			name: "Listen intake",
			pass: true,
			detail: `token configured; \`pl listen\` will serve on port ${config.listen.port}`,
			hard: false,
		};
	}
	return {
		name: "Listen intake",
		pass: false,
		detail:
			"listen.token is unset — `pl listen` will refuse to start (set listen.token in prismalens.config.yaml)",
		hard: false,
	};
}

export default defineCommand({
	meta: {
		name: "doctor",
		description:
			"Preflight check the investigation environment\n\nExamples:\n  $ pl doctor --no-ping",
	},
	args: {
		// citty models `--no-ping` as negation of a `ping` boolean — a literal
		// `noPing` arg would never receive it.
		ping: {
			type: "boolean",
			description: "Live-ping the LLM credential (disable with --no-ping)",
			default: true,
		},
	},
	async run({ args, cmd }) {
		try {
			assertKnownFlags(args, cmd);

			const config = await loadConfig();
			const harness = config.agent.default;
			const noPing = !args.ping;

			const checks: Check[] = [
				checkHarness(harness),
				await checkCredential(config, noPing),
				await checkWorkspace(config),
				checkListenToken(config),
			];

			consola.log("");
			for (const check of checks) {
				const line = `${check.name}: ${check.detail}`;
				if (check.pass) consola.success(line);
				else if (check.hard) consola.error(line);
				else consola.warn(line);
			}
			consola.log("");

			const hardFailures = checks.filter((c) => c.hard && !c.pass);
			if (hardFailures.length > 0) {
				consola.error(
					`${hardFailures.length} required check(s) failed — fix the above before investigating.`,
				);
				process.exit(1);
			}
			consola.success("All required checks passed.");
		} catch (err) {
			consola.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		}
	},
});
