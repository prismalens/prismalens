// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	GITHUB_TOKEN_VARS,
	planLaunch,
	writeLaunchFiles,
} from "@prismalens/agent-host";
import { afterEach, describe, expect, it } from "vitest";
import { githubFor, prismalensLaunchPolicy, type StartedBy } from "./policy.js";

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The agent's env as the launch plan builds it, with the user's GitHub token and helper set. */
function agentEnv(startedBy: StartedBy, unattendedGithub = false) {
	const runDir = mkdtempSync(join(tmpdir(), "pl-policy-"));
	dirs.push(runDir);
	const plan = planLaunch({
		agent: "claude-code",
		level: "auto",
		policy: prismalensLaunchPolicy({ startedBy, unattendedGithub }),
		launch: { command: "claude-agent-acp" },
		cwd: runDir,
		runDir,
		hostEnv: {
			PATH: process.env.PATH,
			HOME: process.env.HOME ?? runDir,
			GH_TOKEN: "ghp_user",
			GITHUB_TOKEN: "ghs_user",
			GH_CONFIG_DIR: "/home/u/.config/gh",
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "credential.helper",
			GIT_CONFIG_VALUE_0: "store",
		},
	});
	writeLaunchFiles(plan);
	return { env: plan.env, runDir };
}

describe("an unattended run's GitHub credentials (#1020 R41)", () => {
	it("goes by who started the thread, and the host can let unattended runs keep it", () => {
		expect(githubFor()).toBe("include");
		expect(githubFor("person")).toBe("include");
		expect(githubFor("alert")).toBe("exclude");
		expect(githubFor("schedule")).toBe("exclude");
		expect(githubFor("schedule", true)).toBe("include");
		expect(prismalensLaunchPolicy().github).toBe("include");
	});

	for (const startedBy of ["alert", "schedule"] as const)
		it(`launches a ${startedBy}'s run with no token, an empty GH_CONFIG_DIR and a blank credential helper`, () => {
			const { env, runDir } = agentEnv(startedBy);
			for (const key of GITHUB_TOKEN_VARS) expect(env[key], key).toBeUndefined();
			expect(env.GH_CONFIG_DIR).toBe(join(runDir, "gh"));
			expect(readdirSync(env.GH_CONFIG_DIR as string)).toEqual([]);
			// `--get` prints the last value; "" means the user's helper list was reset.
			const helper = execFileSync(
				"git",
				["config", "--get", "credential.helper"],
				{ cwd: runDir, env, encoding: "utf8" },
			);
			expect(helper.trim().split(/\r?\n/).at(-1)).toBe("");
		});

	it("keeps a person's token, config dir and helper", () => {
		const { env } = agentEnv("person");
		expect(env.GH_TOKEN).toBe("ghp_user");
		expect(env.GITHUB_TOKEN).toBe("ghs_user");
		expect(env.GH_CONFIG_DIR).toBe("/home/u/.config/gh");
		expect(env.GIT_CONFIG_VALUE_0).toBe("store");
	});

	it("keeps an unattended run's token when the host allows it", () => {
		expect(agentEnv("alert", true).env.GH_TOKEN).toBe("ghp_user");
	});
});
