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

function stubSandbox() {
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
	return { sandbox, spawnSpy };
}

describe("runClaudeCodeBranch isolateSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// prismalens runs the user's own `claude` login and config dir (0003 §2) — it
	// never reads or copies harness credentials, so isolateSettings only clears
	// settingSources; it must never inject CLAUDE_CONFIG_DIR into the child env.
	it("clears settingSources and injects no CLAUDE_CONFIG_DIR when isolateSettings is true", async () => {
		const queryMock = vi.mocked(query);
		queryMock.mockImplementation(async function* () {
			yield { type: "result", result: "ok" };
		} as unknown as typeof query);

		const { sandbox, spawnSpy } = stubSandbox();

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
		expect(options.settingSources).toEqual([]);

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
		const envPassed = spawnSpy.mock.calls[0][2].env;

		expect(envPassed).not.toHaveProperty("CLAUDE_CONFIG_DIR");
		expect(envPassed?.FOO).toBe("bar");
	});

	it("leaves default settingSources when isolateSettings is false", async () => {
		const queryMock = vi.mocked(query);
		queryMock.mockImplementation(async function* () {
			yield { type: "result", result: "ok" };
		} as unknown as typeof query);

		const { sandbox, spawnSpy } = stubSandbox();

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
		const envPassed = spawnSpy.mock.calls[0][2].env;

		expect(envPassed).not.toHaveProperty("CLAUDE_CONFIG_DIR");
		expect(envPassed?.FOO).toBe("bar");

		expect(options.settingSources).toEqual(["user", "project", "local"]);
	});
});
