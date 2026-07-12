// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { query } from "@anthropic-ai/claude-agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProcessFloorSandbox } from "../sandbox/process-floor.js";
import type { SandboxProcess } from "../sandbox/types.js";
import { runClaudeCodeBranch } from "./claude-code-runner.js";

vi.mock("@anthropic-ai/claude-agent-sdk", () => {
	return {
		query: vi.fn(),
	};
});

describe("runClaudeCodeBranch isolateSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("sets CLAUDE_CONFIG_DIR and clears settingSources when isolateSettings is true", async () => {
		const queryMock = vi.mocked(query);
		queryMock.mockImplementation(async function* () {
			yield { type: "result", result: "ok" };
		} as unknown as typeof query);

		const sandbox = createProcessFloorSandbox();
		const spawnSpy = vi.spyOn(sandbox, "spawn");
		spawnSpy.mockImplementation(() => {
			return {
				stdin: {},
				stdout: {},
				stderr: {},
				killed: false,
				kill: () => true,
				on: () => {},
				once: () => {},
				off: () => {},
			} as unknown as SandboxProcess;
		});

		const gen = runClaudeCodeBranch(
			{
				cwd: "/test",
				prompt: "hello",
				isolateSettings: true,
				sandbox,
			},
			{ runId: "1", branchId: "1" },
		);

		for await (const _ of gen) {
			// consume
		}

		expect(queryMock).toHaveBeenCalledTimes(1);
		const options = queryMock.mock.calls[0][0].options;

		// The spawnClaudeCodeProcess factory from options should pass CLAUDE_CONFIG_DIR
		const spawnProcessFn = options.spawnClaudeCodeProcess;
		expect(spawnProcessFn).toBeDefined();

		const abortController = new AbortController();
		spawnProcessFn?.({
			command: "claude",
			args: [],
			env: { FOO: "bar" },
			signal: abortController.signal,
		});

		expect(spawnSpy).toHaveBeenCalledTimes(1);
		const spawnCallArgs = spawnSpy.mock.calls[0];
		const envPassed = spawnCallArgs[2].env;

		expect(envPassed).toHaveProperty("CLAUDE_CONFIG_DIR");
		expect(envPassed?.CLAUDE_CONFIG_DIR).toMatch(/claude-config-/);
		expect(envPassed?.FOO).toBe("bar");

		expect(options.settingSources).toEqual([]);
	});

	it("does not set CLAUDE_CONFIG_DIR and leaves default settingSources when isolateSettings is false", async () => {
		const queryMock = vi.mocked(query);
		queryMock.mockImplementation(async function* () {
			yield { type: "result", result: "ok" };
		} as unknown as typeof query);

		const sandbox = createProcessFloorSandbox();
		const spawnSpy = vi.spyOn(sandbox, "spawn");
		spawnSpy.mockImplementation(() => {
			return {
				stdin: {},
				stdout: {},
				stderr: {},
				killed: false,
				kill: () => true,
				on: () => {},
				once: () => {},
				off: () => {},
			} as unknown as SandboxProcess;
		});

		const gen = runClaudeCodeBranch(
			{
				cwd: "/test",
				prompt: "hello",
				isolateSettings: false,
				sandbox,
			},
			{ runId: "1", branchId: "1" },
		);

		for await (const _ of gen) {
			// consume
		}

		expect(queryMock).toHaveBeenCalledTimes(1);
		const options = queryMock.mock.calls[0][0].options;

		const spawnProcessFn = options.spawnClaudeCodeProcess;
		expect(spawnProcessFn).toBeDefined();

		const abortController = new AbortController();
		spawnProcessFn?.({
			command: "claude",
			args: [],
			env: { FOO: "bar" },
			signal: abortController.signal,
		});

		expect(spawnSpy).toHaveBeenCalledTimes(1);
		const spawnCallArgs = spawnSpy.mock.calls[0];
		const envPassed = spawnCallArgs[2].env;

		expect(envPassed).not.toHaveProperty("CLAUDE_CONFIG_DIR");
		expect(envPassed?.FOO).toBe("bar");

		expect(options.settingSources).toEqual(["user", "project", "local"]);
	});
});
