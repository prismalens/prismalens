/**
 * ACP transport client — drives a rented harness over the Agent Client Protocol
 * (`deepagents --acp`, JSON-RPC over stdio) and yields a flat, typed stream of
 * branch items (ADR-0008, Slice 0).
 *
 * Lifecycle per branch: spawn → `initialize` → `session/new` → `session/prompt`,
 * relaying every `session/update` notification as an `{ kind:"update" }` item and
 * terminating with exactly one `{ kind:"done" }` (the prompt's `stopReason`) or
 * `{ kind:"error" }` (transport/spawn/timeout failure). The stream ALWAYS
 * terminates, so the live UI never hangs.
 *
 * Server→client requests are answered inline: `session/request_permission` via the
 * injected {@link PermissionPolicy} (default: auto-allow, the read-only Slice-0
 * posture — a real approval gate replaces this at the act phase, ADR-0009);
 * `fs/*` is refused (we advertise no fs capability); anything else gets an empty
 * ack so the harness never blocks on us.
 *
 * BYO-key (ADR-0006): the model + credentials are injected via `model`/`env`; the
 * engine never hard-binds a provider.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { AcpUpdate } from "../adapter/acp-adapter.js";

/** One item in a branch's transport stream. Exactly one terminal item ends it. */
export type AcpStreamItem =
	| { kind: "update"; update: AcpUpdate }
	| { kind: "done"; stopReason: string }
	| { kind: "error"; message: string };

/** A single permission option offered by the harness. */
export interface AcpPermissionOption {
	optionId: string;
	name?: string;
	/** allow_once | allow_always | reject_once | reject_always. */
	kind?: string;
}

export interface AcpPermissionRequest {
	options: AcpPermissionOption[];
	toolCall?: { title?: string; toolCallId?: string };
}

/** Decide how to answer a permission request: pick an option, or reject. */
export type PermissionPolicy = (
	req: AcpPermissionRequest,
) => { optionId: string } | { reject: true };

/** Read-only Slice-0 default: approve (the cheapest allow option, else the first). */
export const autoAllowReadOnly: PermissionPolicy = (req) => {
	const allow =
		req.options.find((o) => o.kind === "allow_once") ??
		req.options.find((o) => (o.kind ?? "").startsWith("allow")) ??
		req.options[0];
	return allow ? { optionId: allow.optionId } : { reject: true };
};

export interface AcpClientConfig {
	/** Working directory the harness runs in (its `cwd`). */
	cwd: string;
	/** The investigation prompt sent as the first `session/prompt`. */
	prompt: string;
	/** Harness binary. Default `"deepagents"`. */
	command?: string;
	/** Model id passed via `-M`. Default `"openai:gpt-oss:120b"`. */
	model?: string;
	/** Full arg vector override; when set, `model`/native args are ignored. Default `["--acp","-M",model]`. */
	args?: string[];
	/**
	 * Native passthrough (ADR-0017): deepagents shell allow-list → `-S csv`. When set,
	 * turns the cooperative read-only posture into a real shell restriction.
	 */
	shellAllowList?: string[];
	/** Native passthrough (ADR-0017): run the harness sandboxed → `--sandbox`. */
	sandbox?: boolean;
	/** Native passthrough (ADR-0017): extra CLI args appended after the derived ones. */
	extraArgs?: string[];
	/** Extra env merged OVER `process.env` (BYO-key: OPENAI_API_KEY, OPENAI_BASE_URL, …). */
	env?: NodeJS.ProcessEnv;
	/** MCP servers offered to the session. Default `[]`. */
	mcpServers?: unknown[];
	/** How to answer permission requests. Default {@link autoAllowReadOnly}. */
	permission?: PermissionPolicy;
	/** Timeout for `initialize` + `session/new`. Default 30s. */
	initTimeoutMs?: number;
	/** Timeout for the `session/prompt` round-trip. Default 180s. */
	promptTimeoutMs?: number;
}

const DEFAULT_COMMAND = "deepagents";
const DEFAULT_MODEL = "openai:gpt-oss:120b";

/**
 * Build the deepagents arg vector from the model + native passthrough (ADR-0017):
 * the base `--acp -M <model>`, then the read-only enforcers `-S <csv>` / `--sandbox`,
 * then any extra args. The full `args` override (when set) bypasses this entirely.
 */
function buildAcpArgs(model: string, config: AcpClientConfig): string[] {
	const args = ["--acp", "-M", model];
	if (config.shellAllowList?.length) {
		args.push("-S", config.shellAllowList.join(","));
	}
	if (config.sandbox) args.push("--sandbox");
	if (config.extraArgs?.length) args.push(...config.extraArgs);
	return args;
}
const DEFAULT_INIT_TIMEOUT_MS = 30_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 180_000;
const STDERR_TAIL = 500;

interface JsonRpcMessage {
	jsonrpc?: string;
	id?: number;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: { code?: number; message?: string };
}

/**
 * Run one branch to completion over ACP. Yields `update` items as they stream and
 * a single terminal `done`/`error`. Always cleans up the child process.
 */
export async function* runAcpBranch(
	config: AcpClientConfig,
): AsyncGenerator<AcpStreamItem> {
	const command = config.command ?? DEFAULT_COMMAND;
	const model = config.model ?? DEFAULT_MODEL;
	const args = config.args ?? buildAcpArgs(model, config);
	const permission = config.permission ?? autoAllowReadOnly;
	const initTimeout = config.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
	const promptTimeout = config.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;

	const child = spawn(command, args, {
		cwd: config.cwd,
		env: { ...process.env, ...config.env },
		stdio: ["pipe", "pipe", "pipe"],
	});

	// --- queue plumbing: readline callbacks push items; the generator drains them ---
	const queue: AcpStreamItem[] = [];
	let wake: (() => void) | null = null;
	let finished = false;
	const stderrChunks: string[] = [];
	const pending = new Map<
		number,
		{ resolve: (result: unknown) => void; reject: (err: Error) => void }
	>();
	let nextId = 1;

	const pushItem = (item: AcpStreamItem): void => {
		queue.push(item);
		wake?.();
		wake = null;
	};
	const finish = (): void => {
		finished = true;
		wake?.();
		wake = null;
	};
	const send = (obj: unknown): void => {
		if (child.stdin.writable) child.stdin.write(`${JSON.stringify(obj)}\n`);
	};
	const request = (
		method: string,
		params: Record<string, unknown>,
		timeoutMs: number,
	): Promise<unknown> =>
		new Promise<unknown>((resolve, reject) => {
			const id = nextId++;
			const timer = setTimeout(() => {
				if (pending.delete(id)) {
					reject(new Error(`ACP ${method} timed out after ${timeoutMs}ms`));
				}
			}, timeoutMs);
			pending.set(id, {
				resolve: (result) => {
					clearTimeout(timer);
					resolve(result);
				},
				reject: (err) => {
					clearTimeout(timer);
					reject(err);
				},
			});
			send({ jsonrpc: "2.0", id, method, params });
		});

	const answerPermission = (msg: JsonRpcMessage): void => {
		const params = msg.params ?? {};
		const options = (params.options as AcpPermissionOption[]) ?? [];
		const decision = permission({
			options,
			toolCall: params.toolCall as AcpPermissionRequest["toolCall"],
		});
		if ("optionId" in decision) {
			send({
				jsonrpc: "2.0",
				id: msg.id,
				result: {
					outcome: { outcome: "selected", optionId: decision.optionId },
				},
			});
			return;
		}
		const reject = options.find((o) => (o.kind ?? "").startsWith("reject"));
		send({
			jsonrpc: "2.0",
			id: msg.id,
			result: reject
				? { outcome: { outcome: "selected", optionId: reject.optionId } }
				: { outcome: { outcome: "cancelled" } },
		});
	};

	const handleServerRequest = (msg: JsonRpcMessage): void => {
		const method = msg.method ?? "";
		if (method === "session/request_permission") {
			answerPermission(msg);
		} else if (method.startsWith("fs/")) {
			send({
				jsonrpc: "2.0",
				id: msg.id,
				error: { code: -32601, message: "fs capability not offered" },
			});
		} else {
			send({ jsonrpc: "2.0", id: msg.id, result: {} });
		}
	};

	const rl = createInterface({ input: child.stdout });
	rl.on("line", (raw) => {
		const line = raw.trim();
		if (!line) return;
		let msg: JsonRpcMessage;
		try {
			msg = JSON.parse(line) as JsonRpcMessage;
		} catch {
			return; // ignore non-JSON noise on stdout
		}
		if (msg.id !== undefined && msg.method) {
			handleServerRequest(msg);
		} else if (msg.id !== undefined) {
			const p = pending.get(msg.id);
			if (p) {
				pending.delete(msg.id);
				if (msg.error) {
					p.reject(
						new Error(msg.error.message ?? `ACP error ${msg.error.code}`),
					);
				} else {
					p.resolve(msg.result);
				}
			}
		} else if (msg.method === "session/update") {
			const update = msg.params?.update;
			if (update && typeof update === "object") {
				pushItem({ kind: "update", update: update as AcpUpdate });
			}
		}
	});

	child.stderr.on("data", (d: Buffer) => stderrChunks.push(d.toString()));
	child.on("error", (err) => {
		pushItem({
			kind: "error",
			message: `failed to start ${command}: ${err.message}`,
		});
		finish();
	});
	child.on("exit", (code, signal) => {
		if (finished) return;
		const tail = stderrChunks.join("").trim().slice(-STDERR_TAIL);
		pushItem({
			kind: "error",
			message: `harness exited early (code=${code} signal=${signal})${tail ? `: ${tail}` : ""}`,
		});
		finish();
	});

	try {
		await request(
			"initialize",
			{
				protocolVersion: 1,
				clientCapabilities: {
					fs: { readTextFile: false, writeTextFile: false },
				},
			},
			initTimeout,
		);
		const sessionResult = (await request(
			"session/new",
			{ cwd: config.cwd, mcpServers: config.mcpServers ?? [] },
			initTimeout,
		)) as { sessionId?: string } | null;
		const sessionId = sessionResult?.sessionId;
		if (!sessionId) throw new Error("ACP session/new returned no sessionId");

		// Fire the prompt; its resolution drives the single terminal item.
		request(
			"session/prompt",
			{ sessionId, prompt: [{ type: "text", text: config.prompt }] },
			promptTimeout,
		)
			.then((res) => {
				const stopReason = (res as { stopReason?: string } | null)?.stopReason;
				pushItem({ kind: "done", stopReason: stopReason ?? "end_turn" });
				finish();
			})
			.catch((err: unknown) => {
				pushItem({
					kind: "error",
					message: err instanceof Error ? err.message : String(err),
				});
				finish();
			});

		while (true) {
			while (queue.length > 0) {
				const item = queue.shift();
				if (item) yield item;
			}
			if (finished) break;
			await new Promise<void>((r) => {
				wake = r;
			});
		}
		while (queue.length > 0) {
			const item = queue.shift();
			if (item) yield item;
		}
	} catch (err) {
		yield {
			kind: "error",
			message: err instanceof Error ? err.message : String(err),
		};
	} finally {
		rl.close();
		for (const p of pending.values()) p.reject(new Error("ACP client closing"));
		pending.clear();
		if (!child.killed) child.kill();
	}
}
