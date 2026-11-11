// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The machine checks `pl doctor` and About's diagnostics both run, from this
 * one module, so the CLI and the app never give different results (#936).
 * Agents, sources and credentials stay out; their own pages check them.
 */

import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
} from "node:fs";
import { join, posix, win32 } from "node:path";
import {
	type InstalledService,
	installedService,
	serviceOwnsWorkspace,
} from "./background-service.js";
import { type InstallChannel, installChannel } from "./install-channel.js";
import { nodeVersionProblem } from "./node-version.js";
import { secretFileName } from "./secrets.js";
import { isWindowsMountPath, isWsl } from "./wsl.js";

export interface DiagnosticCheck {
	id: string;
	label: string;
	status: "ok" | "warn" | "fail";
	detail: string;
	fix?: string;
	/** A failure here stops `pl up`; the doctor's verdict counts only these. */
	required: boolean;
}

/** Runs git; the caller chooses the env, so a server can pass its filtered one. */
export type DiagnosticGitRun = (args: string[]) => {
	status: number | null;
	stdout: string;
	error?: Error;
};

/** `<pl> --version` for one `pl` found on PATH, or null when it didn't answer. */
export type VersionRun = (
	path: string,
	platform: NodeJS.Platform,
) => string | null;

export interface DiagnosticsInput {
	workspaceDir: string;
	/** This copy's version. */
	version: string;
	git: DiagnosticGitRun;
	runVersion: VersionRun;
	/** Whose environment git was read in: "this shell" for the CLI. */
	gitScope: string;
	env?: NodeJS.ProcessEnv;
	nodeVersion?: string;
	platform?: NodeJS.Platform;
	channel?: InstallChannel;
	service?: InstalledService | null;
	exists?: (path: string) => boolean;
}

export function nodeCheck(version: string): DiagnosticCheck {
	const problem = nodeVersionProblem(version);
	return problem === null
		? {
				id: "node",
				label: "Node version",
				status: "ok",
				detail: `${version} (patched)`,
				required: true,
			}
		: {
				id: "node",
				label: "Node version",
				status: "fail",
				detail: `${version} — ${problem}`,
				fix: "Upgrade PrismaLens, or the Node it runs on.",
				required: true,
			};
}

/** The workspace exists (it is made when missing) and this user can write it. */
export function workspaceCheck(dir: string): DiagnosticCheck {
	try {
		mkdirSync(dir, { recursive: true });
		accessSync(dir, constants.W_OK);
		return {
			id: "workspace",
			label: "Workspace",
			status: "ok",
			detail: dir,
			required: true,
		};
	} catch (e) {
		return {
			id: "workspace",
			label: "Workspace",
			status: "fail",
			detail: `${dir} — ${(e as Error).message}`,
			fix: "Make the folder writable by the user PrismaLens runs as.",
			required: true,
		};
	}
}

/** The PATH, once, so a bare sudo or service PATH shows. */
export function pathCheck(
	path: string,
	platform: NodeJS.Platform,
): DiagnosticCheck {
	const paths = platform === "win32" ? win32 : posix;
	const entries = path.split(paths.delimiter).filter(Boolean);
	return entries.length === 0
		? {
				id: "path",
				label: "PATH",
				status: "warn",
				detail: "empty",
				fix: "Start PrismaLens from a shell whose PATH finds git and your coding agent.",
				required: false,
			}
		: {
				id: "path",
				label: "PATH",
				status: "ok",
				detail: `${entries.length} entries, starting ${entries.slice(0, 3).join(", ")}${entries.length > 3 ? ", …" : ""}`,
				required: false,
			};
}

const INSTALLER_MARKER = "Added by the PrismaLens installer";

/** Which channel put this `pl` on PATH, from its path or the installer's marker. */
export function channelOfPath(path: string, contents = ""): string {
	if (path.includes("/Cellar/prismalens/") || path.includes("/homebrew/bin/"))
		return "homebrew";
	if (/[\\/]scoop[\\/]/i.test(path)) return "scoop";
	if (contents.includes(INSTALLER_MARKER)) return "installer";
	return "npm";
}

/**
 * Every `pl` on PATH (#717). They all share one workspace, and an older copy
 * refuses a database a newer one has migrated, so more than one is worth a warning.
 */
export function installsCheck(input: {
	version: string;
	channel: InstallChannel;
	path: string;
	platform: NodeJS.Platform;
	env: NodeJS.ProcessEnv;
	exists: (p: string) => boolean;
	runVersion: VersionRun;
}): DiagnosticCheck {
	const { platform } = input;
	const names = platform === "win32" ? ["pl.cmd", "pl.exe"] : ["pl"];
	// The PATH is the given platform's, so its own path rules read it (#776 review).
	const paths = platform === "win32" ? win32 : posix;
	const seen = new Map<string, string>();
	for (const dir of input.path.split(paths.delimiter).filter(Boolean)) {
		for (const name of names) {
			const candidate = paths.join(dir, name);
			if (!input.exists(candidate)) continue;
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
		const version = input.runVersion(p, platform) ?? "version unknown";
		return `${p} (${channelOfPath(seen.get(p) ?? p, contents)}, ${version})`;
	});
	const wslHints: string[] = [];
	if (isWsl(input.env)) {
		for (const p of seen.keys()) {
			if (isWindowsMountPath(p))
				wslHints.push(
					`${p} is the Windows install; it can't run inside WSL. Install PrismaLens inside this distro.`,
				);
		}
	}
	const baseDetail =
		rows.length === 0
			? `this one (${input.version}) is not on PATH`
			: rows.length === 1
				? rows[0]
				: `${rows.length} on PATH, sharing one workspace: ${rows.join("; ")}. An older one stops once a newer one has migrated the database; remove all but one.`;
	const detail =
		wslHints.length > 0
			? `${baseDetail.replace(/\.?$/, ".")} ${wslHints.join(" ")}`
			: baseDetail;
	return {
		id: "installs",
		label: `PrismaLens ${input.version} (${input.channel})`,
		status: rows.length <= 1 && wslHints.length === 0 ? "ok" : "warn",
		detail,
		required: false,
	};
}

/**
 * git and the credential helpers it would use (#673). A helper value is config,
 * never a secret. The background service has its own environment, so what one
 * process sees is not proof the service sees it.
 */
export function gitChecks(
	run: DiagnosticGitRun,
	service: InstalledService | null,
	scope: string,
): DiagnosticCheck[] {
	const version = run(["--version"]);
	if (version.error || version.status !== 0)
		return [
			{
				id: "git",
				label: "Git",
				status: "fail",
				detail:
					"git missing: PrismaLens reads a service's code with git. Install it and run pl doctor again",
				fix: "Install git, then restart PrismaLens.",
				required: true,
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
	const checks: DiagnosticCheck[] = [
		{
			id: "git",
			label: "Git",
			status: "ok",
			detail: `git ${version.stdout.trim().replace(/^git version\s+/, "")} (for ${scope}); ${lines.length ? `credential helpers: ${lines.join("; ")}` : "no credential helper"}`,
			required: true,
		},
	];
	if (service)
		checks.push({
			id: "git-service",
			label: "Git in the background service",
			status: "ok",
			detail:
				"The background service runs with its own environment; helpers that need a desktop keyring or an SSH agent may not work there.",
			required: false,
		});
	return checks;
}

export function webhookTokenCheck(dir: string): DiagnosticCheck {
	const file = join(dir, secretFileName("PRISMALENS_WEBHOOK_SECRET"));
	const exists = existsSync(file);
	return {
		id: "webhook-token",
		label: "Webhook token",
		status: exists ? "ok" : "warn",
		detail: `${file} (${exists ? "exists" : "does not exist yet"})`,
		...(exists
			? {}
			: { fix: "It is created the first time an alert source is set up." }),
		required: false,
	};
}

/** Windows has no background service; the desktop app starts with Windows instead (#1024). */
export const WINDOWS_START_AT_LOGIN =
	"On Windows, turn on Start at login in the desktop app's tray menu.";

export function serviceCheck(
	service: InstalledService | null,
	dir: string,
	platform: NodeJS.Platform = process.platform,
): DiagnosticCheck {
	return {
		id: "service",
		label: "Background service",
		status: "ok",
		detail: !service
			? platform === "win32"
				? `not installed. ${WINDOWS_START_AT_LOGIN}`
				: "not installed (pl service install runs PrismaLens in the background)"
			: `installed on port ${service.port}${serviceOwnsWorkspace(dir, service) ? "" : `, for workspace ${service.workspace}`}; pl service status shows whether it is running`,
		required: false,
	};
}

export function runDiagnostics(input: DiagnosticsInput): DiagnosticCheck[] {
	const env = input.env ?? process.env;
	const platform = input.platform ?? process.platform;
	const service =
		input.service === undefined ? installedService() : input.service;
	const path = env.PATH ?? env.Path ?? "";
	return [
		nodeCheck(input.nodeVersion ?? process.versions.node),
		workspaceCheck(input.workspaceDir),
		pathCheck(path, platform),
		installsCheck({
			version: input.version,
			channel: input.channel ?? installChannel(env),
			path,
			platform,
			env,
			exists: input.exists ?? existsSync,
			runVersion: input.runVersion,
		}),
		...gitChecks(input.git, service, input.gitScope),
		webhookTokenCheck(input.workspaceDir),
		serviceCheck(service, input.workspaceDir, platform),
	];
}
