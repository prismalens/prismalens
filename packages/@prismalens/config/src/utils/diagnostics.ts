// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The machine checks About's diagnostics run, in one place so `pl doctor` can
 * run the same ones (#936: the app and the CLI never give different results).
 * Agents, sources and credentials stay out; their own pages check them.
 */

import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import {
	installedService,
	serviceOwnsWorkspace,
} from "./background-service.js";
import { installChannel } from "./install-channel.js";
import { nodeVersionProblem } from "./node-version.js";
import { secretFileName } from "./secrets.js";

export interface DiagnosticCheck {
	id: string;
	label: string;
	status: "ok" | "warn" | "fail";
	detail: string;
	fix?: string;
}

/** Runs git; the caller chooses the env, so a server can pass its filtered one. */
export type DiagnosticGitRun = (args: string[]) => {
	status: number | null;
	stdout: string;
	error?: Error;
};

export interface DiagnosticsInput {
	workspaceDir: string;
	git: DiagnosticGitRun;
	env?: NodeJS.ProcessEnv;
	nodeVersion?: string;
}

function node(version: string, env: NodeJS.ProcessEnv): DiagnosticCheck {
	const problem = nodeVersionProblem(version);
	return problem === null
		? {
				id: "node",
				label: "Node",
				status: "ok",
				detail: `${version} (patched)`,
			}
		: {
				id: "node",
				label: "Node",
				status: "fail",
				detail: `${version}: ${problem}`,
				fix: `Upgrade PrismaLens (${installChannel(env)}), or the Node it runs on.`,
			};
}

function workspace(dir: string): DiagnosticCheck {
	try {
		accessSync(dir, constants.W_OK);
		return { id: "workspace", label: "Workspace", status: "ok", detail: dir };
	} catch (e) {
		return {
			id: "workspace",
			label: "Workspace",
			status: "fail",
			detail: `${dir}: ${(e as Error).message}`,
			fix: "Make the folder writable by the user PrismaLens runs as.",
		};
	}
}

function path(env: NodeJS.ProcessEnv): DiagnosticCheck {
	const entries = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
	return entries.length === 0
		? {
				id: "path",
				label: "PATH",
				status: "warn",
				detail: "empty",
				fix: "Start PrismaLens from a shell whose PATH finds git and your coding agent.",
			}
		: {
				id: "path",
				label: "PATH",
				status: "ok",
				detail: `${entries.length} entries, starting ${entries.slice(0, 3).join(", ")}${entries.length > 3 ? ", …" : ""}`,
			};
}

function git(run: DiagnosticGitRun): DiagnosticCheck {
	const version = run(["--version"]);
	if (version.error || version.status !== 0)
		return {
			id: "git",
			label: "Git",
			status: "fail",
			detail: "Git isn't installed, or isn't on the PATH PrismaLens runs with.",
			fix: "Install git, then restart PrismaLens.",
		};
	const helpers = run(["config", "--get-regexp", "credential\\..*helper"]);
	const count =
		helpers.status === 0
			? helpers.stdout.split("\n").filter((l) => l.trim()).length
			: 0;
	return {
		id: "git",
		label: "Git",
		status: "ok",
		detail: `git ${version.stdout.trim().replace(/^git version\s+/, "")}; ${count ? `${count} credential helper${count > 1 ? "s" : ""}` : "no credential helper"}`,
	};
}

function webhookToken(dir: string): DiagnosticCheck {
	const file = join(dir, secretFileName("PRISMALENS_WEBHOOK_SECRET"));
	return existsSync(file)
		? {
				id: "webhook-token",
				label: "Webhook token",
				status: "ok",
				detail: file,
			}
		: {
				id: "webhook-token",
				label: "Webhook token",
				status: "warn",
				detail: `${file} doesn't exist yet`,
				fix: "It is created the first time an alert source is set up.",
			};
}

function service(dir: string): DiagnosticCheck {
	const installed = installedService();
	return {
		id: "service",
		label: "Background service",
		status: "ok",
		detail: !installed
			? "not installed; `pl service install` runs PrismaLens in the background"
			: `installed on port ${installed.port}${serviceOwnsWorkspace(dir, installed) ? "" : `, for workspace ${installed.workspace}`}`,
	};
}

export function runDiagnostics(input: DiagnosticsInput): DiagnosticCheck[] {
	const env = input.env ?? process.env;
	return [
		node(input.nodeVersion ?? process.versions.node, env),
		workspace(input.workspaceDir),
		path(env),
		git(input.git),
		webhookToken(input.workspaceDir),
		service(input.workspaceDir),
	];
}
