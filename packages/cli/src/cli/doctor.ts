// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `prismalens doctor` — preflight checklist for `pl up` (ADR-0008/0010, #337/#610):
 * Node, the workspace, PATH, the installs of `pl`, Git, the webhook, port/host and
 * the service. It never checks a coding agent; Settings → Agent does that (#907).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, join, posix, win32 } from "node:path";
import {
	DEFAULT_PORT,
	ensureAppDataDir,
	getAppDataDir,
	installChannel,
	installedService,
	isWindowsMountPath,
	isWsl,
	readInstanceFile,
	secretFileName,
	serviceOwnsWorkspace,
} from "@prismalens/config";
import { defineCommand } from "citty";
import consola from "consola";
import { cliVersion } from "../version.js";
import { assertKnownFlags } from "./flags.js";
import { windowsSpawnPlan } from "./windows-spawn.js";

// engines.node >=24 (scripts/pack-cli.mjs) is a major floor; these are the patched releases
// of each supported line (CVE-2026-111497, #998). Raise a line's floor on the next advisory.
export const NODE_PATCH_FLOORS: Record<number, string> = {
	24: "24.22.1",
	26: "26.12.1",
};

interface Check {
	name: string;
	pass: boolean;
	detail: string;
	hard: boolean;
}

const parts = (v: string) => v.split(".").map(Number);

/** Why this Node is refused, or null when it is a patched release of a supported line. */
export function nodeVersionProblem(version: string): string | null {
	const [major, minor, patch] = parts(version);
	const lines = Object.keys(NODE_PATCH_FLOORS).map(Number);
	if (major < Math.min(...lines))
		return `prismalens requires Node >= ${Math.min(...lines)}`;
	const floor = NODE_PATCH_FLOORS[major];
	if (!floor) {
		return major > Math.max(...lines)
			? null
			: `Node ${major} is not a supported line; use ${Object.values(NODE_PATCH_FLOORS).join(" or ")} or later`;
	}
	const [, fMinor, fPatch] = parts(floor);
	const ok = minor > fMinor || (minor === fMinor && patch >= fPatch);
	return ok
		? null
		: `Node ${version} lacks a security fix; upgrade to ${floor} or later`;
}

function checkNodeVersion(): Check {
	const problem = nodeVersionProblem(process.versions.node);
	return {
		name: "Node version",
		pass: problem === null,
		detail:
			problem === null
				? `${process.versions.node} (patched)`
				: `${process.versions.node} — ${problem}`,
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

/** The PATH, once, so a bare sudo or service PATH shows. */
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

const INSTALLER_MARKER = "Added by the PrismaLens installer";

/** Which channel put this `pl` on PATH, from its path or the installer's marker. */
export function channelOfPath(path: string, contents = ""): string {
	if (path.includes("/Cellar/prismalens/") || path.includes("/homebrew/bin/")) {
		return "homebrew";
	}
	if (/[\\/]scoop[\\/]/i.test(path)) return "scoop";
	if (contents.includes(INSTALLER_MARKER)) return "installer";
	return "npm";
}

/**
 * Every `pl` on PATH (#717). They all share one workspace, and an older copy
 * refuses a database a newer one has migrated, so more than one is worth a warning.
 */
export function checkInstalls(
	path = process.env.PATH ?? "",
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
	exists: (p: string) => boolean = existsSync,
): Check {
	const names = platform === "win32" ? ["pl.cmd", "pl.exe"] : ["pl"];
	// The PATH is the given platform's, so its own path rules read it (#776 review).
	const paths = platform === "win32" ? win32 : posix;
	const seen = new Map<string, string>();
	for (const dir of path.split(paths.delimiter).filter(Boolean)) {
		for (const name of names) {
			const candidate = paths.join(dir, name);
			if (!exists(candidate)) continue;
			let real = candidate;
			try {
				real = realpathSync(candidate);
			} catch {}
			if ([...seen.values()].some((r) => r === real)) continue;
			seen.set(candidate, real);
		}
	}
	const rows = [...seen.keys()].map((p) => {
		let contents = "";
		try {
			contents = readFileSync(p, "utf8").slice(0, 400);
		} catch {}
		// A .cmd path with a space needs cmd.exe's own quoting, which the engine already has.
		const plan = windowsSpawnPlan(p, ["--version"], platform);
		const out = spawnSync(plan.command, plan.args, {
			...plan.options,
			encoding: "utf8",
			timeout: 5_000,
		});
		const version = out.status === 0 ? out.stdout.trim() : "version unknown";
		return `${p} (${channelOfPath(seen.get(p) ?? p, contents)}, ${version})`;
	});
	const wslHints: string[] = [];
	if (isWsl(env)) {
		for (const p of seen.keys()) {
			if (isWindowsMountPath(p)) {
				wslHints.push(
					`${p} is the Windows install; it can't run inside WSL. Install PrismaLens inside this distro.`,
				);
			}
		}
	}
	const baseDetail =
		rows.length === 0
			? `this one (${cliVersion()}) is not on PATH`
			: rows.length === 1
				? rows[0]
				: `${rows.length} on PATH, sharing one workspace: ${rows.join("; ")}. An older one stops once a newer one has migrated the database; remove all but one.`;
	const detail =
		wslHints.length > 0
			? `${baseDetail.replace(/\.?$/, ".")} ${wslHints.join(" ")}`
			: baseDetail;

	return {
		name: `PrismaLens ${cliVersion()} (${installChannel()})`,
		pass: rows.length <= 1 && wslHints.length === 0,
		detail,
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

export function checkService(
	service = installedService(),
	workspace = getAppDataDir(),
): Check {
	return {
		name: "Background service",
		pass: true,
		detail: !service
			? "not installed (pl service install runs PrismaLens in the background)"
			: `installed on port ${service.port}${serviceOwnsWorkspace(workspace, service) ? "" : `, for workspace ${service.workspace}`}; pl service status shows whether it is running`,
		hard: false,
	};
}

type GitRun = (args: string[]) => {
	status: number | null;
	stdout: string;
	error?: Error;
};

const runGit: GitRun = (args) => {
	const r = spawnSync("git", args, {
		encoding: "utf8",
		timeout: 5_000,
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
	return { status: r.status, stdout: r.stdout ?? "", error: r.error };
};

/**
 * git and the credential helpers this shell would use (#673). A helper value is
 * config, never a secret. The background service has its own environment, so
 * what this shell sees is not proof the service sees it.
 */
export function checkGit(
	run: GitRun = runGit,
	service = installedService(),
): Check[] {
	const version = run(["--version"]);
	if (version.error || version.status !== 0)
		return [
			{
				name: "Git",
				pass: false,
				detail:
					"git missing: PrismaLens reads a service's code with git. Install it and run pl doctor again",
				hard: true,
			},
		];
	const helpers = run(["config", "--get-regexp", "credential\\..*helper"]);
	const lines =
		helpers.status === 0
			? helpers.stdout
					.split("\n")
					.filter((l) => l.trim())
					.map((l) => {
						const [key = "", ...value] = l.trim().split(/\s+/);
						const host = key
							.replace(/^credential\.?/i, "")
							.replace(/\.?helper$/i, "")
							.replace(/^https?:\/\//i, "")
							.replace(/\/$/, "");
						return `${host || "all hosts"}: ${value.join(" ")}`;
					})
			: [];
	const checks: Check[] = [
		{
			name: "Git",
			pass: true,
			detail: `git ${version.stdout.trim().replace(/^git version\s+/, "")} (for this shell); ${lines.length ? `credential helpers: ${lines.join("; ")}` : "no credential helper"}`,
			hard: true,
		},
	];
	if (service)
		checks.push({
			name: "Git in the background service",
			pass: true,
			detail:
				"The background service runs with its own environment; helpers that need a desktop keyring or an SSH agent may not work there.",
			hard: false,
		});
	return checks;
}

/** What `pl up` would pick, without creating the instance file the doctor only reports on. */
function workspacePort(): number {
	const workspace = getAppDataDir();
	try {
		const instance = readInstanceFile(workspace);
		if (instance) return instance.port;
	} catch {
		// An invalid instance file fails `pl up` with its own message.
	}
	return DEFAULT_PORT;
}

function checkPortHost(): Check {
	const port = process.env.PRISMALENS_PORT ?? String(workspacePort());
	const host = process.env.PRISMALENS_HOST ?? "127.0.0.1";
	return {
		name: "Port/host",
		pass: true,
		detail: `${host}:${port}`,
		hard: false,
	};
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/** The URL Alertmanager posts to, and whether another machine can reach this bind. */
export function checkWebhookUrl(
	host = process.env.PRISMALENS_HOST ?? "127.0.0.1",
	port = process.env.PRISMALENS_PORT ?? String(workspacePort()),
	protocol = process.env.PRISMALENS_PROTOCOL === "https" ? "https" : "http",
): Check {
	const path = "/api/webhooks/prometheus";
	const loopback = LOOPBACK.has(host);
	const wildcard = host === "0.0.0.0" || host === "::";
	const shown = host.includes(":") ? `[${host}]` : host;
	return {
		name: "Webhook URL",
		pass: true,
		detail: loopback
			? `${protocol}://${shown}:${port}${path}; only this machine can reach it. For Alertmanager elsewhere, bind with --host and use this machine's LAN or tailnet address`
			: wildcard
				? `${protocol}://<this machine's LAN or tailnet address>:${port}${path}; other machines can reach it`
				: `${protocol}://${shown}:${port}${path}; machines that can route to ${host} can reach it`,
		hard: false,
	};
}

/** The closing line; agents never reach it (#907). */
export function summary(checks: Check[]): {
	level: "success" | "error";
	line: string;
} {
	const hardFailures = checks.filter((c) => c.hard && !c.pass);
	if (hardFailures.length > 0) {
		return {
			level: "error",
			line: `${hardFailures.length} required check(s) failed. Fix the above before running \`pl up\`.`,
		};
	}
	return { level: "success", line: "All required checks passed." };
}

export const AGENTS_LINE =
	"Coding agents: pl doctor does not check them. Settings → Agent in the app lists the ones that can run, and Add agent sets one up.";

export default defineCommand({
	meta: {
		name: "doctor",
		description: "Preflight check the `pl up` environment",
	},
	args: {
		port: {
			type: "string",
			description:
				"Port `pl up` will listen on (default: the workspace's port, or PRISMALENS_PORT)",
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

			const checks: Check[] = [
				checkNodeVersion(),
				checkAppDataDir(),
				checkPath(),
				checkInstalls(),
				...checkGit(),
				checkWebhookToken(),
				checkPortHost(),
				checkWebhookUrl(),
				checkService(),
			];

			consola.log("");
			for (const check of checks) {
				const line = `${check.name}: ${check.detail}`;
				if (check.pass) consola.success(line);
				else if (check.hard) consola.error(line);
				else consola.warn(line);
			}
			consola.log(AGENTS_LINE);
			consola.log("");

			const verdict = summary(checks);
			consola[verdict.level](verdict.line);
			if (verdict.level === "error") process.exit(1);
		} catch (err) {
			consola.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		}
	},
});
