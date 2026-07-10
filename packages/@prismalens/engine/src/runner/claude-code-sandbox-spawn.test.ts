// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import type {
	Sandbox,
	SandboxLimits,
	SandboxProcess,
} from "../sandbox/types.js";
import { sandboxSpawnClaudeCodeProcess } from "./claude-code-sandbox-spawn.js";

class FakeSandboxProcess extends EventEmitter implements SandboxProcess {
	public stdin = new PassThrough();
	public stdout = new PassThrough();
	public stderr = new PassThrough();
	public killed = false;

	constructor() {
		super();
	}

	public kill(signal?: NodeJS.Signals): boolean {
		this.killed = true;
		return true;
	}
}

class FakeSandbox implements Sandbox {
	public id = "fake-sandbox";
	public fidelity: "enforced" | "cooperative" = "cooperative";
	public spawnMock = vi.fn<Sandbox["spawn"]>();

	public spawn(
		command: string,
		args: string[],
		options: { cwd: string; env?: NodeJS.ProcessEnv; limits?: SandboxLimits },
	): SandboxProcess {
		return this.spawnMock(command, args, options);
	}

	public async destroy(): Promise<void> {}
}

describe("sandboxSpawnClaudeCodeProcess", () => {
	it("forwards command, args, cwd, env, and limits to sandbox.spawn", () => {
		const sandbox = new FakeSandbox();
		const fakeChild = new FakeSandboxProcess();
		sandbox.spawnMock.mockReturnValue(fakeChild);

		const spawnFn = sandboxSpawnClaudeCodeProcess(sandbox, {
			cwd: "/opt/fallback",
			limits: { maxMemoryBytes: 1024 },
		});

		const abortController = new AbortController();
		const options: SpawnOptions = {
			command: "claude",
			args: ["--version"],
			cwd: "/opt/explicit",
			env: { FOO: "bar" },
			signal: abortController.signal,
		};

		spawnFn(options);

		expect(sandbox.spawnMock).toHaveBeenCalledTimes(1);
		expect(sandbox.spawnMock).toHaveBeenCalledWith("claude", ["--version"], {
			cwd: "/opt/explicit",
			env: { FOO: "bar" },
			limits: { maxMemoryBytes: 1024 },
		});
	});

	it("falls back to opts.cwd when SpawnOptions.cwd is omitted", () => {
		const sandbox = new FakeSandbox();
		const fakeChild = new FakeSandboxProcess();
		sandbox.spawnMock.mockReturnValue(fakeChild);

		const spawnFn = sandboxSpawnClaudeCodeProcess(sandbox, {
			cwd: "/opt/fallback",
		});

		const abortController = new AbortController();
		const options: SpawnOptions = {
			command: "claude",
			args: [],
			env: {},
			signal: abortController.signal,
		};

		spawnFn(options);

		expect(sandbox.spawnMock).toHaveBeenCalledWith("claude", [], {
			cwd: "/opt/fallback",
			env: {},
		});
	});

	it("falls back to process.cwd() when both cwds are omitted", () => {
		const sandbox = new FakeSandbox();
		const fakeChild = new FakeSandboxProcess();
		sandbox.spawnMock.mockReturnValue(fakeChild);

		const spawnFn = sandboxSpawnClaudeCodeProcess(sandbox);

		const abortController = new AbortController();
		const options: SpawnOptions = {
			command: "claude",
			args: [],
			env: {},
			signal: abortController.signal,
		};

		spawnFn(options);

		expect(sandbox.spawnMock).toHaveBeenCalledWith("claude", [], {
			cwd: process.cwd(),
			env: {},
		});
	});

	it("returns a process object with correct shape (stdin, stdout, killed=false, exitCode=null)", () => {
		const sandbox = new FakeSandbox();
		const fakeChild = new FakeSandboxProcess();
		sandbox.spawnMock.mockReturnValue(fakeChild);

		const spawnFn = sandboxSpawnClaudeCodeProcess(sandbox);

		const abortController = new AbortController();
		const result = spawnFn({
			command: "claude",
			args: [],
			env: {},
			signal: abortController.signal,
		});

		expect(result.stdin).toBe(fakeChild.stdin);
		expect(result.stdout).toBe(fakeChild.stdout);
		expect(result.killed).toBe(false);
		expect(result.exitCode).toBeNull();
	});

	it("maps exit correctly (close -> exit, updates exitCode)", () => {
		const sandbox = new FakeSandbox();
		const fakeChild = new FakeSandboxProcess();
		sandbox.spawnMock.mockReturnValue(fakeChild);

		const spawnFn = sandboxSpawnClaudeCodeProcess(sandbox);

		const abortController = new AbortController();
		const result = spawnFn({
			command: "claude",
			args: [],
			env: {},
			signal: abortController.signal,
		});

		const exitListener = vi.fn();
		result.on("exit", exitListener);

		expect(result.exitCode).toBeNull();

		fakeChild.emit("close", 0, null);

		expect(exitListener).toHaveBeenCalledWith(0, null);
		expect(result.exitCode).toBe(0);
	});

	it("maps error correctly", () => {
		const sandbox = new FakeSandbox();
		const fakeChild = new FakeSandboxProcess();
		sandbox.spawnMock.mockReturnValue(fakeChild);

		const spawnFn = sandboxSpawnClaudeCodeProcess(sandbox);

		const abortController = new AbortController();
		const result = spawnFn({
			command: "claude",
			args: [],
			env: {},
			signal: abortController.signal,
		});

		const errorListener = vi.fn();
		result.on("error", errorListener);

		const err = new Error("boom");
		fakeChild.emit("error", err);

		expect(errorListener).toHaveBeenCalledWith(err);
	});

	it("hard-kills the child when the abort signal fires after spawn", () => {
		const sandbox = new FakeSandbox();
		const fakeChild = new FakeSandboxProcess();
		sandbox.spawnMock.mockReturnValue(fakeChild);

		const killSpy = vi.spyOn(fakeChild, "kill");

		const spawnFn = sandboxSpawnClaudeCodeProcess(sandbox);

		const abortController = new AbortController();
		spawnFn({
			command: "claude",
			args: [],
			env: {},
			signal: abortController.signal,
		});

		expect(killSpy).not.toHaveBeenCalled();
		abortController.abort();
		expect(killSpy).toHaveBeenCalledWith("SIGKILL");
	});

	it("hard-kills the child immediately when the abort signal is already aborted", () => {
		const sandbox = new FakeSandbox();
		const fakeChild = new FakeSandboxProcess();
		sandbox.spawnMock.mockReturnValue(fakeChild);

		const killSpy = vi.spyOn(fakeChild, "kill");

		const spawnFn = sandboxSpawnClaudeCodeProcess(sandbox);

		const abortController = new AbortController();
		abortController.abort();

		spawnFn({
			command: "claude",
			args: [],
			env: {},
			signal: abortController.signal,
		});

		expect(killSpy).toHaveBeenCalledWith("SIGKILL");
	});

	it("delegates kill() calls", () => {
		const sandbox = new FakeSandbox();
		const fakeChild = new FakeSandboxProcess();
		sandbox.spawnMock.mockReturnValue(fakeChild);

		const killSpy = vi.spyOn(fakeChild, "kill");

		const spawnFn = sandboxSpawnClaudeCodeProcess(sandbox);

		const abortController = new AbortController();
		const result = spawnFn({
			command: "claude",
			args: [],
			env: {},
			signal: abortController.signal,
		});

		const killResult = result.kill("SIGTERM");
		expect(killSpy).toHaveBeenCalledWith("SIGTERM");
		expect(killResult).toBe(true);
		expect(result.killed).toBe(true);
	});

	it("supports once and off", () => {
		const sandbox = new FakeSandbox();
		const fakeChild = new FakeSandboxProcess();
		sandbox.spawnMock.mockReturnValue(fakeChild);

		const spawnFn = sandboxSpawnClaudeCodeProcess(sandbox);

		const abortController = new AbortController();
		const result = spawnFn({
			command: "claude",
			args: [],
			env: {},
			signal: abortController.signal,
		});

		const onceListener = vi.fn();
		result.once("exit", onceListener);

		const offListener = vi.fn();
		result.on("exit", offListener);
		result.off("exit", offListener);

		fakeChild.emit("close", 1, null);
		fakeChild.emit("close", 1, null);

		expect(onceListener).toHaveBeenCalledTimes(1);
		expect(offListener).not.toHaveBeenCalled();
	});
});
