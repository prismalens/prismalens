// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * About → Diagnostics (#932): what `pl doctor` checks, run by the server
 * itself, so a service's own environment is what gets checked. Host only.
 */

import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { Injectable } from "@nestjs/common";
import {
	getAppDataDir,
	installChannel,
	installedService,
	nodeVersionProblem,
	secretFileName,
	serviceOwnsWorkspace,
} from "@prismalens/config";
import type { Diagnostics, DoctorCheck } from "@prismalens/contracts";

export type GitRun = (args: string[]) => {
	status: number | null;
	stdout: string;
	error?: Error;
};

const runGit: GitRun = (args) => {
	const r = spawnSync("git", args, {
		encoding: "utf8",
		timeout: 5_000,
		windowsHide: true,
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
	return { status: r.status, stdout: r.stdout ?? "", error: r.error };
};

@Injectable()
export class DiagnosticsService {
	// Fields rather than constructor parameters: Nest would try to inject them. Tests set them.
	env: NodeJS.ProcessEnv = process.env;
	nodeVersion = process.versions.node;
	git: GitRun = runGit;
	now: () => number = Date.now;

	run(): Diagnostics {
		const workspace = getAppDataDir();
		return {
			checks: [
				this.node(),
				this.workspace(workspace),
				this.path(),
				this.gitCheck(),
				this.webhookToken(workspace),
				this.service(workspace),
			],
			ranAt: new Date(this.now()).toISOString(),
		};
	}

	private node(): DoctorCheck {
		const problem = nodeVersionProblem(this.nodeVersion);
		return problem === null
			? {
					id: "node",
					label: "Node",
					status: "ok",
					detail: `${this.nodeVersion} (patched)`,
				}
			: {
					id: "node",
					label: "Node",
					status: "fail",
					detail: `${this.nodeVersion}: ${problem}`,
					fix: `Upgrade PrismaLens (${installChannel(this.env)}), or the Node it runs on.`,
				};
	}

	private workspace(dir: string): DoctorCheck {
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

	private path(): DoctorCheck {
		const entries = (this.env.PATH ?? this.env.Path ?? "")
			.split(delimiter)
			.filter(Boolean);
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

	private gitCheck(): DoctorCheck {
		const version = this.git(["--version"]);
		if (version.error || version.status !== 0)
			return {
				id: "git",
				label: "Git",
				status: "fail",
				detail:
					"Git isn't installed, or isn't on the PATH PrismaLens runs with.",
				fix: "Install git, then restart PrismaLens.",
			};
		const helpers = this.git([
			"config",
			"--get-regexp",
			"credential\\..*helper",
		]);
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

	private webhookToken(dir: string): DoctorCheck {
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

	private service(dir: string): DoctorCheck {
		const service = installedService();
		return {
			id: "service",
			label: "Background service",
			status: "ok",
			detail: !service
				? "not installed; `pl service install` runs PrismaLens in the background"
				: `installed on port ${service.port}${serviceOwnsWorkspace(dir, service) ? "" : `, for workspace ${service.workspace}`}`,
		};
	}
}
