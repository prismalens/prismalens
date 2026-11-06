// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * About → Diagnostics (#932): the checks `@prismalens/config` holds for `pl
 * doctor` too (#936), run by the server, so a service's own environment is
 * what gets checked. Host only.
 */

import { spawnSync } from "node:child_process";
import { Injectable } from "@nestjs/common";
import {
	type DiagnosticGitRun,
	getAppDataDir,
	runDiagnostics,
	type VersionRun,
} from "@prismalens/config";
import type { Diagnostics } from "@prismalens/contracts";
import { resolveServiceVersion } from "../../shared/utils/service-version.js";
import { gitEnv } from "../harness/git-env.js";

export type GitRun = DiagnosticGitRun;

const runGit: GitRun = (args) => {
	// The machine source keeps the user's own credential helpers, which this check reports.
	const r = spawnSync("git", args, {
		encoding: "utf8",
		timeout: 5_000,
		windowsHide: true,
		env: gitEnv({ source: "machine" }),
	});
	return { status: r.status, stdout: r.stdout ?? "", error: r.error };
};

/** `pl --version` of a copy on PATH; a Windows `.cmd` runs through cmd.exe, quoted whole. */
export const plVersion: VersionRun = (path, platform) => {
	const out =
		platform === "win32" && /\.cmd$/i.test(path)
			? spawnSync("cmd.exe", ["/d", "/s", "/c", `""${path}" --version"`], {
					encoding: "utf8",
					timeout: 5_000,
					windowsHide: true,
					windowsVerbatimArguments: true,
				})
			: spawnSync(path, ["--version"], {
					encoding: "utf8",
					timeout: 5_000,
					windowsHide: true,
				});
	return out.status === 0 ? String(out.stdout).trim() : null;
};

@Injectable()
export class DiagnosticsService {
	// Fields rather than constructor parameters: Nest would try to inject them. Tests set them.
	env: NodeJS.ProcessEnv = process.env;
	nodeVersion = process.versions.node;
	git: GitRun = runGit;
	runVersion: VersionRun = plVersion;
	now: () => number = Date.now;

	run(): Diagnostics {
		return {
			checks: runDiagnostics({
				workspaceDir: getAppDataDir(),
				version: resolveServiceVersion(),
				git: this.git,
				runVersion: this.runVersion,
				gitScope: "PrismaLens",
				env: this.env,
				nodeVersion: this.nodeVersion,
			}),
			ranAt: new Date(this.now()).toISOString(),
		};
	}
}
