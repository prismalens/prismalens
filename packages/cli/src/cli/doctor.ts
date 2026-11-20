// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `prismalens doctor` — preflight checklist for `pl up` (ADR-0008/0010, #337/#610):
 * Node, the workspace, PATH, the installs of `pl`, Git, the webhook, port/host and
 * the service. It never checks a coding agent; Settings → Agent does that (#907).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
	DEFAULT_PORT,
	type DiagnosticCheck,
	type DiagnosticGitRun,
	getAppDataDir,
	gitChecks,
	installChannel,
	installedService,
	installsCheck,
	readInstanceFile,
	runDiagnostics,
	type VersionRun,
	webhookTokenCheck,
} from "@prismalens/config";
import { defineCommand } from "citty";
import consola from "consola";
import { cliVersion } from "../version.js";
import { assertKnownFlags } from "./flags.js";
import { windowsSpawnPlan } from "./windows-spawn.js";

export { NODE_PATCH_FLOORS, nodeVersionProblem } from "@prismalens/config";

interface Check {
	name: string;
	pass: boolean;
	detail: string;
	hard: boolean;
}

/** A shared check as the doctor prints it; only `required` failures fail the run. */
function toCheck(d: DiagnosticCheck): Check {
	return {
		name: d.label,
		pass: d.status === "ok",
		detail: d.detail,
		hard: d.required,
	};
}

type GitRun = DiagnosticGitRun;

const runGit: GitRun = (args) => {
	const r = spawnSync("git", args, {
		windowsHide: true,
		encoding: "utf8",
		timeout: 5_000,
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
	return { status: r.status, stdout: r.stdout ?? "", error: r.error };
};

/** `pl --version` of one copy on PATH; a .cmd path with a space needs cmd.exe's own quoting. */
const plVersion: VersionRun = (path, platform) => {
	const plan = windowsSpawnPlan(path, ["--version"], platform);
	const out = spawnSync(plan.command, plan.args, {
		windowsHide: true,
		...plan.options,
		encoding: "utf8",
		timeout: 5_000,
	});
	return out.status === 0 ? out.stdout.trim() : null;
};

export { channelOfPath } from "@prismalens/config";

export function checkInstalls(
	path = process.env.PATH ?? "",
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
	exists: (p: string) => boolean = existsSync,
): Check {
	return toCheck(
		installsCheck({
			version: cliVersion(),
			channel: installChannel(),
			path,
			platform,
			env,
			exists,
			runVersion: plVersion,
		}),
	);
}

export function checkWebhookToken(): Check {
	return toCheck(webhookTokenCheck(getAppDataDir()));
}

export function checkGit(
	run: GitRun = runGit,
	service = installedService(),
): Check[] {
	return gitChecks(run, service, "this shell").map(toCheck);
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

/** The machine checks are About's diagnostics too (#936); only the bind is the doctor's own. */
export function doctorChecks(git: GitRun = runGit): Check[] {
	return [
		...runDiagnostics({
			workspaceDir: getAppDataDir(),
			version: cliVersion(),
			git,
			runVersion: plVersion,
			gitScope: "this shell",
		}).map(toCheck),
		checkPortHost(),
		checkWebhookUrl(),
	];
}

const NODE_CHECK_NAME = "Node version";

export const NODE_BELOW_FLOOR =
	"Node is below the supported version. pl up still starts, but it runs without the Node security fixes; upgrade Node.";

/** The closing line; agents never reach it (#907). */
export function summary(checks: Check[]): {
	level: "success" | "error";
	line: string;
} {
	const hardFailures = checks.filter((c) => c.hard && !c.pass);
	// Nothing refuses an old Node, so its failure says what still runs (#1024).
	const node = hardFailures.some((c) => c.name === NODE_CHECK_NAME);
	const others = hardFailures.length - (node ? 1 : 0);
	if (others > 0) {
		return {
			level: "error",
			line: `${others} required check(s) failed. Fix the above before running \`pl up\`.${node ? ` ${NODE_BELOW_FLOOR}` : ""}`,
		};
	}
	if (node) return { level: "error", line: NODE_BELOW_FLOOR };
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

			const checks = doctorChecks();

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
