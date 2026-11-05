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
} from "@prismalens/config";
import type { Diagnostics } from "@prismalens/contracts";
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

@Injectable()
export class DiagnosticsService {
	// Fields rather than constructor parameters: Nest would try to inject them. Tests set them.
	env: NodeJS.ProcessEnv = process.env;
	nodeVersion = process.versions.node;
	git: GitRun = runGit;
	now: () => number = Date.now;

	run(): Diagnostics {
		return {
			checks: runDiagnostics({
				workspaceDir: getAppDataDir(),
				git: this.git,
				env: this.env,
				nodeVersion: this.nodeVersion,
			}),
			ranAt: new Date(this.now()).toISOString(),
		};
	}
}
