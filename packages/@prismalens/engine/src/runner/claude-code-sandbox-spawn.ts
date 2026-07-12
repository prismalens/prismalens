// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Adapts the Claude Agent SDK's `spawnClaudeCodeProcess` hook (SpawnOptions ⇒
 * SpawnedProcess) onto the prismalens {@link Sandbox} port (ADR-0020, issue #64): the
 * SDK-computed CLI command/args/env are forwarded VERBATIM into `sandbox.spawn`, and the
 * returned {@link SandboxProcess} is wrapped to satisfy the SDK's SpawnedProcess contract
 * — `"close"` is mapped to the SDK's `"exit"` event, `exitCode` is tracked off that close,
 * and the SDK's forwarded (post-grace) abort signal hard-kills the child.
 */
import { EventEmitter } from "node:events";
import type {
	SpawnedProcess,
	SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import type { Sandbox, SandboxLimits } from "../sandbox/types.js";

export function sandboxSpawnClaudeCodeProcess(
	sandbox: Sandbox,
	opts: { cwd?: string; limits?: SandboxLimits; env?: NodeJS.ProcessEnv } = {},
): (options: SpawnOptions) => SpawnedProcess {
	return (options: SpawnOptions): SpawnedProcess => {
		const child = sandbox.spawn(options.command, options.args, {
			cwd: options.cwd ?? opts.cwd ?? process.cwd(),
			env: opts.env ? { ...options.env, ...opts.env } : options.env,
			...(opts.limits ? { limits: opts.limits } : {}),
		});

		const emitter = new EventEmitter();
		let exitCode: number | null = null;
		let exited = false;

		child.on("close", (code, signal) => {
			exitCode = code;
			exited = true;
			emitter.emit("exit", code, signal);
		});
		child.on("error", (err) => emitter.emit("error", err));

		// Honor the SDK's forwarded (post-grace) abort signal: hard-kill the child.
		const onAbort = (): void => {
			if (!exited && !child.killed) child.kill("SIGKILL");
		};
		if (options.signal.aborted) onAbort();
		else options.signal.addEventListener("abort", onAbort, { once: true });

		return {
			stdin: child.stdin,
			stdout: child.stdout,
			get killed() {
				return child.killed;
			},
			get exitCode() {
				return exitCode;
			},
			kill(signal: NodeJS.Signals): boolean {
				return child.kill(signal);
			},
			on(event, listener): void {
				emitter.on(event, listener as (...args: unknown[]) => void);
			},
			once(event, listener): void {
				emitter.once(event, listener as (...args: unknown[]) => void);
			},
			off(event, listener): void {
				emitter.off(event, listener as (...args: unknown[]) => void);
			},
		};
	};
}
