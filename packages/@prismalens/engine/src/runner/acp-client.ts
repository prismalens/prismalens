// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * ACP session over stdio (Agent Client Protocol v1, JSON-RPC). One session per
 * investigation: `initialize` → `session/new` → one or more `session/prompt`
 * turns. Every `session/update` is yielded from the turn that caused it; every
 * `session/request_permission` is answered by the injected policy. The child is
 * spawned into a Sandbox (ADR 0004); the process floor by default.
 */
import { createInterface } from "node:readline";
import type { AcpUpdate } from "../adapter/acp-adapter.js";
import type { PermissionPolicy, PermissionRequest } from "../run/permission.js";
import { createProcessFloorSandbox } from "../sandbox/process-floor.js";
import type {
	Sandbox,
	SandboxLimits,
	SandboxProcess,
} from "../sandbox/types.js";

export type AcpStreamItem =
	| { kind: "update"; update: AcpUpdate }
	| {
			kind: "permission";
			request: PermissionRequest;
			allowed: boolean;
			why?: string;
	  }
	| { kind: "done"; stopReason: string }
	| { kind: "error"; message: string };

export interface AcpSessionConfig {
	command: string;
	args: string[];
	cwd: string;
	env?: NodeJS.ProcessEnv;
	sandbox?: Sandbox;
	limits?: SandboxLimits;
	permission: PermissionPolicy;
	initTimeoutMs?: number;
	promptTimeoutMs?: number;
	/** Raw wire lines, both directions, for the run transcript. Best effort. */
	onWire?: (direction: "in" | "out", line: string) => void;
}

const DEFAULT_INIT_TIMEOUT_MS = 120_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 900_000;
const STDERR_TAIL = 500;

interface JsonRpcMessage {
	jsonrpc?: string;
	id?: number;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: { code?: number; message?: string; data?: unknown };
}

function jsonRpcErrorText(error: NonNullable<JsonRpcMessage["error"]>): string {
	const head = error.message ?? `ACP error ${error.code}`;
	if (error.data === undefined) return head;
	const data =
		typeof error.data === "string" ? error.data : JSON.stringify(error.data);
	return `${head} — ${data.slice(0, 500)}`;
}

export interface AcpAgentInfo {
	name?: string;
	version?: string;
}

export class AcpSession {
	private readonly sandbox: Sandbox;
	private readonly ownsSandbox: boolean;
	private child: SandboxProcess | null = null;
	private sessionId: string | null = null;
	private nextId = 1;
	private readonly pending = new Map<
		number,
		{ resolve: (r: unknown) => void; reject: (e: Error) => void }
	>();
	private queue: AcpStreamItem[] = [];
	private wake: (() => void) | null = null;
	private closed = false;
	private exitMessage: string | null = null;
	private readonly stderrChunks: string[] = [];
	agent: AcpAgentInfo = {};

	constructor(private readonly config: AcpSessionConfig) {
		this.sandbox = config.sandbox ?? createProcessFloorSandbox();
		this.ownsSandbox = config.sandbox === undefined;
	}

	async open(): Promise<void> {
		const { config } = this;
		const child = this.sandbox.spawn(config.command, config.args, {
			cwd: config.cwd,
			env: config.env,
			...(config.limits ? { limits: config.limits } : {}),
		});
		this.child = child;
		child.stderr.on("data", (d: Buffer) =>
			this.stderrChunks.push(d.toString()),
		);
		child.on("error", (err) =>
			this.fail(`failed to start ${config.command}: ${err.message}`),
		);
		// A harness can die at any moment — wrong version, not authenticated,
		// OOM, killed — and when it does its pipes error asynchronously. Node
		// rethrows an unhandled stream `error` event as an uncaught exception,
		// which under `pl up` (one process serving the API, the UI and the
		// dispatch loop) would take the whole server down instead of failing the
		// one run. Route them into the same path as an early exit; `fail` keeps
		// the first message, so whichever of these and `close` wins the race,
		// the reason still carries the harness's own stderr.
		for (const [name, stream] of [
			["stdin", child.stdin],
			["stdout", child.stdout],
			["stderr", child.stderr],
		] as const) {
			stream.on("error", (err: Error) => {
				if (this.closed) return;
				const tail = this.stderrTail();
				this.fail(
					`harness ${name} failed (${err.message})${tail ? `: ${tail}` : ""}`,
				);
			});
		}
		child.on("close", (code, signal) => {
			if (this.closed) return;
			const tail = this.stderrTail();
			this.fail(
				child.timedOut
					? `harness exceeded its wall-clock limit (${config.limits?.wallClockMs}ms) and was killed${tail ? `: ${tail}` : ""}`
					: `harness exited early (code=${code} signal=${signal})${tail ? `: ${tail}` : ""}`,
			);
		});
		const lines = createInterface({ input: child.stdout });
		lines.on("line", (raw) => this.onLine(raw));
		// readline re-emits its input stream's error on the Interface, and an
		// Interface with no listener is a second uncaught exception — the stdout
		// handler above does not cover it. `fail` keeps the first message, so
		// this is idempotent with it.
		lines.on("error", (err: Error) => {
			if (this.closed) return;
			this.fail(`harness stdout failed (${err.message})`);
		});

		const init = (await this.request(
			"initialize",
			{
				protocolVersion: 1,
				clientCapabilities: {
					fs: { readTextFile: false, writeTextFile: false },
				},
			},
			config.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS,
		)) as { agentInfo?: AcpAgentInfo } | null;
		this.agent = init?.agentInfo ?? {};
		const session = (await this.request(
			"session/new",
			{ cwd: config.cwd, mcpServers: [] },
			config.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS,
		)) as { sessionId?: string } | null;
		if (!session?.sessionId)
			throw new Error("ACP session/new returned no sessionId");
		this.sessionId = session.sessionId;
	}

	/** One prompt turn. Yields updates and permission decisions, then exactly one done or error. */
	async *prompt(text: string): AsyncGenerator<AcpStreamItem> {
		if (!this.sessionId) throw new Error("AcpSession.prompt before open()");
		if (this.exitMessage) {
			yield { kind: "error", message: this.exitMessage };
			return;
		}
		let turnDone = false;
		this.request(
			"session/prompt",
			{ sessionId: this.sessionId, prompt: [{ type: "text", text }] },
			this.config.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS,
		)
			.then((res) => {
				const stopReason = (res as { stopReason?: string } | null)?.stopReason;
				this.push({ kind: "done", stopReason: stopReason ?? "end_turn" });
			})
			.catch((err: unknown) => {
				this.push({
					kind: "error",
					message: err instanceof Error ? err.message : String(err),
				});
			});
		while (!turnDone) {
			while (this.queue.length > 0) {
				const item = this.queue.shift() as AcpStreamItem;
				if (item.kind === "done" || item.kind === "error") turnDone = true;
				yield item;
				if (turnDone) return;
			}
			await new Promise<void>((r) => {
				this.wake = r;
			});
		}
	}

	/** Cancel the in-flight turn; the harness answers with a done carrying stopReason "cancelled". */
	cancel(): void {
		if (!this.sessionId) return;
		this.send({
			jsonrpc: "2.0",
			method: "session/cancel",
			params: { sessionId: this.sessionId },
		});
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		for (const p of this.pending.values())
			p.reject(new Error("ACP session closing"));
		this.pending.clear();
		if (this.child && !this.child.killed) this.child.kill();
		if (this.ownsSandbox) await this.sandbox.destroy();
	}

	private push(item: AcpStreamItem): void {
		this.queue.push(item);
		this.wake?.();
		this.wake = null;
	}

	private stderrTail(): string {
		return this.stderrChunks.join("").trim().slice(-STDERR_TAIL);
	}

	private fail(message: string): void {
		if (this.exitMessage) return;
		this.exitMessage = message;
		for (const p of this.pending.values()) p.reject(new Error(message));
		this.pending.clear();
		this.push({ kind: "error", message });
	}

	private send(obj: unknown): void {
		const line = JSON.stringify(obj);
		this.config.onWire?.("out", line);
		// No `writable` pre-check: it stays true until Node notices the peer is
		// gone, so it never prevented a write to a dead pipe — it only hid the
		// race. The stdin `error` handler installed in open() is what makes a
		// failed write safe, and it reports the dead harness rather than
		// throwing. Writing to an already-destroyed stream lands there too.
		this.child?.stdin.write(`${line}\n`);
	}

	private request(
		method: string,
		params: Record<string, unknown>,
		timeoutMs: number,
	): Promise<unknown> {
		return new Promise<unknown>((resolve, reject) => {
			const id = this.nextId++;
			const timer = setTimeout(() => {
				if (this.pending.delete(id))
					reject(new Error(`ACP ${method} timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (r) => {
					clearTimeout(timer);
					resolve(r);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			});
			this.send({ jsonrpc: "2.0", id, method, params });
		});
	}

	private onLine(raw: string): void {
		const line = raw.trim();
		if (!line) return;
		this.config.onWire?.("in", line);
		let msg: JsonRpcMessage;
		try {
			msg = JSON.parse(line) as JsonRpcMessage;
		} catch {
			return;
		}
		if (msg.id !== undefined && msg.method) {
			this.onServerRequest(msg);
		} else if (msg.id !== undefined) {
			const p = this.pending.get(msg.id);
			if (!p) return;
			this.pending.delete(msg.id);
			if (msg.error) p.reject(new Error(jsonRpcErrorText(msg.error)));
			else p.resolve(msg.result);
		} else if (msg.method === "session/update") {
			const update = msg.params?.update;
			if (update && typeof update === "object")
				this.push({ kind: "update", update: update as AcpUpdate });
		}
	}

	private onServerRequest(msg: JsonRpcMessage): void {
		const method = msg.method ?? "";
		if (method === "session/request_permission") {
			const params = msg.params ?? {};
			const request: PermissionRequest = {
				options: (params.options as PermissionRequest["options"]) ?? [],
				toolCall: params.toolCall as PermissionRequest["toolCall"],
			};
			const decision = this.config.permission(request);
			const optionId = decision.optionId;
			this.send({
				jsonrpc: "2.0",
				id: msg.id,
				result: optionId
					? { outcome: { outcome: "selected", optionId } }
					: { outcome: { outcome: "cancelled" } },
			});
			this.push({
				kind: "permission",
				request,
				allowed: decision.allow,
				...(decision.allow ? {} : { why: decision.why }),
			});
			return;
		}
		if (method.startsWith("fs/")) {
			this.send({
				jsonrpc: "2.0",
				id: msg.id,
				error: { code: -32601, message: "fs capability not offered" },
			});
			return;
		}
		this.send({ jsonrpc: "2.0", id: msg.id, result: {} });
	}
}
