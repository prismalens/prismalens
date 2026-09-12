// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `prismalens doctor` — preflight checklist for `pl up` (ADR-0008/0010, #337/#610).
 *
 * No config loader, no LLM credential check, no listen-token check: prismalens
 * makes no model calls and has no webhook listener command any more. What is
 * left is what actually gates a boot:
 *  - Node version
 *  - the app data directory (created by `pl up` itself)
 *  - a harness on PATH (prismalens never bundles or installs one — #337 C3/C4)
 *  - the port/host `pl up` will bind, informational only
 */
import { ensureAppDataDir, getAppDataDir } from "@prismalens/config";
import { HARNESS_REGISTRY, type HarnessId } from "@prismalens/config/harness";
import {
	isOnPath,
	resolveHarnessSelection,
} from "@prismalens/config/harness-selection";
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
			name: "App data dir",
			pass: true,
			detail: dir,
			hard: true,
		};
	} catch (err) {
		return {
			name: "App data dir",
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
		const pass = isOnPath(descriptor.binary);
		return {
			name: `Harness: ${descriptor.label}`,
			pass,
			detail: pass
				? `${descriptor.binary} found on PATH`
				: `${descriptor.binary} not found on PATH`,
			hard: false,
		};
	});
}

/**
 * HARD: at least one registry harness must be on PATH. Prismalens never bundles
 * or installs a harness (#337 C3/C4) — this is the detect-and-report failure.
 */
export function checkAnyHarnessOnPath(perHarness: Check[]): Check {
	const pass = perHarness.some((c) => c.pass);
	const listing = (
		Object.values(HARNESS_REGISTRY) as (typeof HARNESS_REGISTRY)[HarnessId][]
	)
		.map((d) => d.id)
		.join(", ");
	return {
		name: "Harness available",
		pass,
		detail: pass
			? "at least one harness is installed"
			: `no harness found on PATH — install one of: ${listing}`,
		hard: true,
	};
}

/** Which harness `pl up` would actually pick, per the shared selection gate. */
function checkAutoSelection(): Check {
	const envHarness = process.env.PRISMALENS_HARNESS;
	const selection = resolveHarnessSelection({ envHarness });
	if (selection.runnable) {
		return {
			name: "Auto-selected harness",
			pass: true,
			detail: `${selection.harness}${selection.auto ? " (auto)" : " (pinned by PRISMALENS_HARNESS)"}${selection.verified ? "" : ", not yet verified"}`,
			hard: false,
		};
	}
	return {
		name: "Auto-selected harness",
		pass: false,
		detail: selection.reason,
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
	args: {},
	async run({ args, cmd }) {
		try {
			assertKnownFlags(args, cmd);

			const harnessChecks = checkHarnessesOnPath();

			const checks: Check[] = [
				checkNodeVersion(),
				checkAppDataDir(),
				...harnessChecks,
				checkAnyHarnessOnPath(harnessChecks),
				checkAutoSelection(),
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
				consola.error(
					`${hardFailures.length} required check(s) failed — fix the above before running \`pl up\`.`,
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
