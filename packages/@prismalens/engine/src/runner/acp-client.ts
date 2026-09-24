// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * ACP session over stdio (Agent Client Protocol v1, JSON-RPC). One session per
 * investigation: `initialize` → `session/new` → one or more `session/prompt`
 * turns. Every `session/update` is yielded from the turn that caused it; every
 * `session/request_permission` is answered by the injected policy. The child is
 * spawned as a child by the process launcher (ADR 0004 §5).
 */
import { createInterface } from "node:readline";
import type {
	InitializeResponse,
	NewSessionResponse,
	RequestPermissionRequest,
	SessionUpdate,
	StopReason,
	ToolCallStatus,
	ToolKind,
} from "@agentclientprotocol/sdk";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { AcpUpdate } from "../adapter/acp-adapter.js";
import { createProcessLauncher } from "../launch/process.js";
import type {
	HarnessChild,
	HarnessLauncher,
	RunLimits,
} from "../launch/types.js";
import type { PermissionPolicy, PermissionRequest } from "../run/permission.js";

export type AcpStreamItem =
	| { kind: "update"; update: AcpUpdate }
	| {
			kind: "permission";
			request: PermissionRequest;
			allowed: boolean;
			why?: string;
			warn?: string;
	  }
	| { kind: "done"; stopReason: string }
	| { kind: "error"; message: string };

/**
 * Every value SDK 1.4.0's types allow, for the fields a harness drifts on
 * first. The SDK's zod schemas are private and its transport drops or strips
 * what they reject, so the transport stays ours and these lists are how the
 * SDK stays the authority (#639 rec 2). The `Covers` check below fails to
 * compile when an SDK upgrade adds a value one of them lacks.
 */
const KNOWN_UPDATES = [
	"agent_message_chunk",
	"agent_thought_chunk",
	"available_commands_update",
	"compaction_summary_chunk",
	"compaction_update",
	"config_option_update",
	"current_mode_update",
	"plan",
	"plan_removed",
	"plan_update",
	"session_info_update",
	"tool_call",
	"tool_call_update",
	"usage_update",
	"user_message_chunk",
] as const satisfies readonly SessionUpdate["sessionUpdate"][];
const KNOWN_TOOL_KINDS = [
	"read",
	"edit",
	"delete",
	"move",
	"search",
	"execute",
	"think",
	"fetch",
	"switch_mode",
	"other",
] as const satisfies readonly ToolKind[];
const KNOWN_TOOL_STATUSES = [
	"pending",
	"in_progress",
	"completed",
	"failed",
] as const satisfies readonly ToolCallStatus[];
const KNOWN_STOP_REASONS = [
	"end_turn",
	"max_tokens",
	"max_turn_requests",
	"refusal",
	"cancelled",
] as const satisfies readonly StopReason[];
type Covers<Union, List extends readonly unknown[]> = [
	Exclude<Union, List[number]>,
] extends [never]
	? true
	: never;
const _covers: [
	Covers<SessionUpdate["sessionUpdate"], typeof KNOWN_UPDATES>,
	Covers<ToolKind, typeof KNOWN_TOOL_KINDS>,
	Covers<ToolCallStatus, typeof KNOWN_TOOL_STATUSES>,
	Covers<StopReason, typeof KNOWN_STOP_REASONS>,
] = [true, true, true, true];
void _covers;

const KNOWN: Record<AcpDrift["field"], ReadonlySet<string>> = {
	sessionUpdate: new Set(KNOWN_UPDATES),
	kind: new Set(KNOWN_TOOL_KINDS),
	status: new Set(KNOWN_TOOL_STATUSES),
	stopReason: new Set(KNOWN_STOP_REASONS),
};

/**
 * A value the harness sent that SDK 1.4.0 does not know. It is logged and the
 * message passes through unchanged; drift never fails a run. Extra fields are
 * not drift: ACP allows them (`_meta`, custom variants).
 */
export interface AcpDrift {
	method: "session/update" | "session/prompt";
	field: "sessionUpdate" | "kind" | "status" | "stopReason";
	value: string;
}

export interface AcpSessionConfig {
	command: string;
	args: string[];
	cwd: string;
	env?: NodeJS.ProcessEnv;
	launcher?: HarnessLauncher;
	limits?: RunLimits;
	permission: PermissionPolicy;
	/** Sent as `_meta` on `session/new`. */
	sessionMeta?: Record<string, unknown>;
	initTimeoutMs?: number;
	promptTimeoutMs?: number;
	/** Raw wire lines, both directions, for the run transcript. Best effort. */
	onWire?: (direction: "in" | "out", line: string) => void;
	/** Harness stderr as it arrives, so the host can log it (#600). */
	onStderr?: (chunk: string) => void;
	/** A value unknown to the ACP SDK, once per session per value. */
	onDrift?: (drift: AcpDrift) => void;
}

const DEFAULT_INIT_TIMEOUT_MS = 120_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 900_000;
/** Write errors that mean "the child is gone", not "the pipe misbehaved". */
const PIPE_GONE = new Set(["EPIPE", "ERR_STREAM_DESTROYED"]);
/** How long an EPIPE waits for the child's own `close` to explain itself. */
const PIPE_DEATH_GRACE_MS = 50;

function nodeErrorCode(err: Error): string {
	return (err as NodeJS.ErrnoException).code ?? "";
}

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

/** A JSON-RPC error answer from the harness, keeping its code (-32000 is ACP's auth_required). */
export class AcpRpcError extends Error {
	constructor(
		message: string,
		readonly code: number | undefined,
	) {
		super(message);
	}
}

export type AcpAgentInfo = Partial<
	Pick<NonNullable<InitializeResponse["agentInfo"]>, "name" | "version">
>;

export interface AcpAuthMethod {
	id: string;
	name?: string;
}

/** One model the harness itself offers for this session. */
export interface AcpOfferedModel {
	id: string;
	name: string;
}

/**
 * The models a `session/new` answer offers: the `select` config option in
 * category `model`, flattening groups. Empty when the harness offers none.
 * Tolerant: an option of an unknown shape is skipped, never fatal.
 */
export function offeredModels(
	configOptions: NewSessionResponse["configOptions"] | unknown,
): AcpOfferedModel[] {
	if (!Array.isArray(configOptions)) return [];
	const out: AcpOfferedModel[] = [];
	for (const option of configOptions as Array<Record<string, unknown>>) {
		if (option?.category !== "model" || option.type !== "select") continue;
		const entries = Array.isArray(option.options) ? option.options : [];
		for (const entry of entries as Array<Record<string, unknown>>) {
			const flat = Array.isArray(entry?.options)
				? (entry.options as Array<Record<string, unknown>>)
				: [entry];
			for (const o of flat) {
				if (typeof o?.value !== "string") continue;
				out.push({
					id: o.value,
					name: typeof o.name === "string" ? o.name : o.value,
				});
			}
		}
	}
	return out;
}

export class AcpSession {
	private readonly launcher: HarnessLauncher;
	private readonly ownsLauncher: boolean;
	private child: HarnessChild | null = null;
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
	private readonly driftSeen = new Set<string>();
	agent: AcpAgentInfo = {};
	authMethods: AcpAuthMethod[] = [];
	/** What `session/new` offered in its `model` config option; empty when nothing. */
	models: AcpOfferedModel[] = [];

	constructor(private readonly config: AcpSessionConfig) {
		this.launcher = config.launcher ?? createProcessLauncher();
		this.ownsLauncher = config.launcher === undefined;
	}

	async open(): Promise<void> {
		const { config } = this;
		const child = this.launcher.spawn(config.command, config.args, {
			cwd: config.cwd,
			env: config.env,
			...(config.limits ? { limits: config.limits } : {}),
		});
		this.child = child;
		// setEncoding keeps a multibyte character split across two chunks intact.
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			this.stderrChunks.push(chunk);
			config.onStderr?.(chunk);
		});
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
				const report = () => {
					if (this.closed) return;
					const tail = this.stderrTail();
					this.fail(
						`harness ${name} failed (${err.message})${tail ? `: ${tail}` : ""}`,
					);
				};
				// A write to a harness that is already exiting fails with EPIPE
				// BEFORE its `close` event and before its last stderr chunk lands,
				// so `fail`'s first-message-wins would keep "stdin failed (write
				// EPIPE)" — the one message that says nothing about why the harness
				// died. Give `close` a moment to win with the exit code and stderr;
				// if it never comes, this still reports.
				if (name === "stdin" && PIPE_GONE.has(nodeErrorCode(err))) {
					setTimeout(report, PIPE_DEATH_GRACE_MS).unref();
					return;
				}
				report();
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
				protocolVersion: PROTOCOL_VERSION,
				clientCapabilities: {
					fs: { readTextFile: false, writeTextFile: false },
				},
			},
			config.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS,
		)) as InitializeResponse | null;
		this.agent = (init?.agentInfo ?? {}) as AcpAgentInfo;
		this.authMethods = Array.isArray(init?.authMethods)
			? (init.authMethods as AcpAuthMethod[])
			: [];
		const session = (await this.request(
			"session/new",
			{
				cwd: config.cwd,
				mcpServers: [],
				...(config.sessionMeta ? { _meta: config.sessionMeta } : {}),
			},
			config.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS,
		)) as Partial<NewSessionResponse> | null;
		if (!session?.sessionId)
			throw new Error("ACP session/new returned no sessionId");
		this.sessionId = session.sessionId;
		this.models = offeredModels(session.configOptions);
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
				this.drift("session/prompt", "stopReason", stopReason);
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
		if (this.ownsLauncher) await this.launcher.destroy();
	}

	private push(item: AcpStreamItem): void {
		this.queue.push(item);
		this.wake?.();
		this.wake = null;
	}

	/** Reports `value` once per session when it is a string the SDK does not know. */
	private drift(
		method: AcpDrift["method"],
		field: AcpDrift["field"],
		value: unknown,
	): void {
		if (typeof value !== "string" || KNOWN[field].has(value)) return;
		const key = `${method}.${field}=${value}`;
		if (this.driftSeen.has(key)) return;
		this.driftSeen.add(key);
		this.config.onDrift?.({ method, field, value });
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
			if (msg.error)
				p.reject(new AcpRpcError(jsonRpcErrorText(msg.error), msg.error.code));
			else p.resolve(msg.result);
		} else if (msg.method === "session/update") {
			const update = msg.params?.update;
			if (update && typeof update === "object") {
				const u = update as Record<string, unknown>;
				this.drift("session/update", "sessionUpdate", u.sessionUpdate);
				if (
					u.sessionUpdate === "tool_call" ||
					u.sessionUpdate === "tool_call_update"
				) {
					this.drift("session/update", "kind", u.kind);
					this.drift("session/update", "status", u.status);
				}
				this.push({ kind: "update", update: update as AcpUpdate });
			}
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
				...(decision.allow
					? decision.warn
						? { warn: decision.warn }
						: {}
					: { why: decision.why }),
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
