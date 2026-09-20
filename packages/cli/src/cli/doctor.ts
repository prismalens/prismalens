// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `prismalens doctor` — preflight checklist for `pl up` (ADR-0008/0010, #337/#610).
 *
 * No config loader, no LLM credential check, no listen-token check: prismalens
 * makes no model calls and has no webhook listener command any more. What is
 * left is what actually gates a boot:
 *  - Node version
 *  - the workspace directory (created by `pl up` itself); `--workspace` and
 *    PRISMALENS_WORKSPACE_DIR are honoured the way `pl up` honours them
 *  - a harness on PATH (prismalens never bundles or installs one — #337 C3/C4),
 *    and the model a run would ask it for
 *  - the sandbox `auto` would pick, because the cooperative floor stops no
 *    read outside the snapshot (#337 run e, G17)
 *  - the port/host `pl up` will bind, informational only
 */
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import {
	ensureAppDataDir,
	getAppDataDir,
	secretFileName,
} from "@prismalens/config";
import {
	HARNESS_REGISTRY,
	type HarnessId,
	resolveHarnessModel,
} from "@prismalens/config/harness";
import {
	installHints,
	isOnPath,
	resolveHarnessSelection,
	resolveOnPath,
} from "@prismalens/config/harness-selection";
import { isSrtAvailable, probeHarness } from "@prismalens/engine";
import { defineCommand } from "citty";
import consola from "consola";
import { assertKnownFlags } from "./flags.js";

const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 13;

interface Check {
	name: string;
	pass: boolean;
	detail: string;
	hard: boolean;
}

function checkNodeVersion(): Check {
	const [major, minor] = process.versions.node.split(".").map(Number);
	const pass =
		major > MIN_NODE_MAJOR ||
		(major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR);
	return {
		name: "Node version",
		pass,
		detail: pass
			? `${process.versions.node} (>= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} required)`
			: `${process.versions.node} — prismalens requires Node >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}`,
		hard: true,
	};
}

function checkAppDataDir(): Check {
	try {
		const dir = ensureAppDataDir();
		return {
			name: "Workspace",
			pass: true,
			detail: dir,
			hard: true,
		};
	} catch (err) {
		return {
			name: "Workspace",
			pass: false,
			detail: `${getAppDataDir()} — ${err instanceof Error ? err.message : String(err)}`,
			hard: true,
		};
	}
}

/** For every registry entry, is its binary on PATH — the existing PATH scan. */
export function checkHarnessesOnPath(): Check[] {
	return (
		Object.values(HARNESS_REGISTRY) as (typeof HARNESS_REGISTRY)[HarnessId][]
	).map((descriptor) => {
		const resolved = resolveOnPath(descriptor.binary);
		const companion =
			!resolved && descriptor.companionBinary
				? resolveOnPath(descriptor.companionBinary)
				: null;
		return {
			name: `Harness: ${descriptor.label}`,
			pass: resolved !== null,
			detail: resolved
				? `${descriptor.binary} found at ${resolved}`
				: companion
					? `${descriptor.label} found at ${companion}, adapter missing. Install: ${descriptor.install}`
					: `${descriptor.binary} not found on PATH`,
			hard: false,
		};
	});
}

/** The PATH the harness scan used, once, so a bare sudo or service PATH shows without a dump per row. */
function checkPath(): Check {
	const entries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
	const head = entries.slice(0, 3).join(", ");
	return {
		name: "PATH",
		pass: entries.length > 0,
		detail:
			entries.length === 0
				? "empty"
				: `${entries.length} entries, starting ${head}${entries.length > 3 ? ", …" : ""}`,
		hard: false,
	};
}

/**
 * HARD: at least one registry harness must be on PATH. Prismalens never bundles
 * or installs a harness (#337 C3/C4) — this is the detect-and-report failure.
 */
export function checkAnyHarnessOnPath(perHarness: Check[]): Check {
	const pass = perHarness.some((c) => c.pass);
	return {
		name: "Harness available",
		pass,
		detail: pass
			? "at least one harness is installed"
			: `no harness found on PATH. Install one: ${installHints()}`,
		hard: true,
	};
}

/**
 * ACP handshake against every harness on PATH (#630, Unit D on #337): PATH
 * presence says a binary exists; a handshake says it speaks ACP, not that it is
 * signed in (see probeHarness). `initialize` +
 * `session/new`, no prompt turn, 10 s per harness, sequential — a hung
 * harness reports its own line and the doctor moves on to the next one.
 */
export async function checkHarnessHandshake(): Promise<Check[]> {
	const installed = (
		Object.values(HARNESS_REGISTRY) as (typeof HARNESS_REGISTRY)[HarnessId][]
	).filter((descriptor) => isOnPath(descriptor.binary));
	const results: Check[] = [];
	for (const descriptor of installed) {
		const probe = await probeHarness(descriptor.id);
		results.push({
			name: `Harness ACP handshake: ${descriptor.label}`,
			pass: probe.outcome === "answers-acp",
			detail: probe.detail,
			hard: false,
		});
	}
	return results;
}

/**
 * Which harness `pl up` would pick, per the shared selection gate, and the model
 * it would ask for. The doctor cannot see the app's persisted Settings → Harness
 * choice, so it says so: a pin saved there wins over what is printed here.
 */
export function checkAutoSelection(): Check[] {
	const envHarness = process.env.PRISMALENS_HARNESS;
	const selection = resolveHarnessSelection({ envHarness, pinSource: "env" });
	if (!selection.runnable) {
		return [
			{
				name: "Selected harness",
				pass: false,
				detail: selection.reason,
				hard: false,
			},
		];
	}
	const model = resolveHarnessModel(selection.harness);
	return [
		{
			name: "Selected harness",
			pass: true,
			detail: `${selection.harness}${selection.auto ? " (auto; a harness saved under Settings → Harness wins)" : " (pinned by PRISMALENS_HARNESS)"}${selection.verified ? "" : ", not yet verified"}`,
			hard: false,
		},
		{
			name: "Model",
			pass: model.source === "product-default",
			detail:
				model.source === "product-default"
					? `${model.model} (verified default; Settings → Harness → Model overrides it)`
					: `${selection.harness} has no verified default, so the harness picks its own model unless Settings → Harness → Model sets one`,
			hard: false,
		},
	];
}

/**
 * The sandbox `auto` would pick. Without srt the run gets the cooperative
 * process floor, which stops no read outside the snapshot; #337 run e watched
 * `ls ../..` list every run in the workspace there.
 */
export function checkSandbox(): Check {
	const srt = isSrtAvailable();
	return {
		name: "Sandbox",
		pass: srt,
		detail: srt
			? "srt found; runs get an enforced filesystem and egress boundary"
			: "srt not found; runs use the cooperative process floor, which does not stop a read outside the snapshot. Install @anthropic-ai/sandbox-runtime for an enforced boundary (docs.prismalens.io/cli/sandboxing/)",
		hard: false,
	};
}

export function checkWebhookToken(): Check {
	const filePath = join(
		getAppDataDir(),
		secretFileName("PRISMALENS_WEBHOOK_SECRET"),
	);
	const exists = existsSync(filePath);
	return {
		name: "Webhook token",
		pass: exists,
		detail: `${filePath} (${exists ? "exists" : "does not exist yet"})`,
		hard: false,
	};
}

function checkPortHost(): Check {
	const port = process.env.PRISMALENS_PORT ?? "3001";
	const host = process.env.PRISMALENS_HOST ?? "127.0.0.1";
	return {
		name: "Port/host",
		pass: true,
		detail: `${host}:${port}`,
		hard: false,
	};
}

export default defineCommand({
	meta: {
		name: "doctor",
		description: "Preflight check the `pl up` environment",
	},
	args: {
		port: {
			type: "string",
			description:
				"Port `pl up` will listen on (default 3001, or PRISMALENS_PORT)",
		},
		host: {
			type: "string",
			description:
				"Host `pl up` will bind (default localhost, or PRISMALENS_HOST)",
		},
		workspace: {
			type: "string",
			description:
				"Data directory `pl up` will use (default ~/.prismalens, or PRISMALENS_WORKSPACE_DIR)",
		},
	},
	async run({ args, cmd }) {
		try {
			assertKnownFlags(args, cmd);
			// The same three knobs `pl up` takes, so the doctor reports the install `pl up` will run (#337 run e, G12).
			if (args.port) process.env.PRISMALENS_PORT = String(args.port);
			if (args.host) process.env.PRISMALENS_HOST = String(args.host);
			if (args.workspace) {
				process.env.PRISMALENS_WORKSPACE_DIR = String(args.workspace);
			}

			const harnessChecks = checkHarnessesOnPath();
			const handshakeChecks = await checkHarnessHandshake();

			const checks: Check[] = [
				checkNodeVersion(),
				checkAppDataDir(),
				checkPath(),
				...harnessChecks,
				checkAnyHarnessOnPath(harnessChecks),
				...handshakeChecks,
				...checkAutoSelection(),
				checkSandbox(),
				checkWebhookToken(),
				checkPortHost(),
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
				const onlyHarness = hardFailures.every(
					(c) => c.name === "Harness available",
				);
				consola.error(
					onlyHarness
						? "No harness on PATH. `pl up` still starts, but Investigate stays disabled until one is installed."
						: `${hardFailures.length} required check(s) failed. Fix the above before running \`pl up\`.`,
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
