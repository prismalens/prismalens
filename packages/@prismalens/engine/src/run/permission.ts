// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The agent's own mode decides what it asks; the run's permission level
 * answers it (#673 w21 ruling 2026-10-10). At Ask always every ask waits on
 * the operator's Approve or Deny, and nobody answering denies it.
 */
import { createHash, randomUUID } from "node:crypto";
import type { AccessLevel } from "@prismalens/config/harness";
import {
	ASK_TIMEOUT_MS,
	type AskAnswer,
	type PermissionAskOutcome,
} from "@prismalens/contracts/schemas";

export interface PermissionOption {
	optionId: string;
	name?: string;
	/** allow_once | allow_always | reject_once | reject_always */
	kind?: string;
}

export interface PermissionRequest {
	options: PermissionOption[];
	/** The sub-agent session that asked; absent for the main session (#1025). */
	sessionId?: string;
	toolCall?: {
		title?: string;
		toolCallId?: string;
		kind?: string;
		rawInput?: unknown;
		locations?: { path?: string }[];
		_meta?: unknown;
	};
}

export type PermissionDecision =
	| {
			allow: true;
			optionId: string;
			outcome: "approved" | "allowed";
			warn?: string;
	  }
	| {
			allow: false;
			optionId?: string;
			why: string;
			outcome: Exclude<PermissionAskOutcome, "approved" | "allowed">;
	  };

/** One ask: `askId` names it in the conversation; `signal` aborts when the turn is cancelled. */
export interface AskContext {
	askId: string;
	signal: AbortSignal;
	/** This ask's window; the policy's own timeout when absent. 0 denies at once. */
	timeoutMs?: number;
	/** The run's wall clock cut the window short. */
	clamped?: boolean;
}

/** Kept between an ask's lapse and the launcher's kill, so the denial reaches the agent first. */
export const ASK_KILL_MARGIN_MS = 60_000;

/**
 * An ask's window (#673 w21): the full timeout, unless the run's wall clock
 * ends sooner; then what is left before the kill, less the margin.
 */
export function askWindow(
	askMs: number,
	wallClockMs: number | undefined,
	elapsedMs: number,
): { timeoutMs: number; clamped: boolean } {
	if (wallClockMs === undefined) return { timeoutMs: askMs, clamped: false };
	const left = wallClockMs - elapsedMs - ASK_KILL_MARGIN_MS;
	return left < askMs
		? { timeoutMs: Math.max(0, left), clamped: true }
		: { timeoutMs: askMs, clamped: false };
}

export type PermissionPolicy = (
	req: PermissionRequest,
	ctx: AskContext,
) => PermissionDecision | Promise<PermissionDecision>;

/** The option of `kind` (`allow` or `reject`), the once-only one first. */
export function optionOf(
	req: PermissionRequest,
	kind: "allow" | "reject",
): PermissionOption | undefined {
	return (
		req.options.find((o) => o.kind === `${kind}_once`) ??
		req.options.find((o) => o.kind?.startsWith(kind))
	);
}

/** A denial: the agent's own reject option when it offered one, else ACP's cancelled outcome. */
/**
 * The abort reason when PrismaLens itself is closing, as opposed to the operator's Stop.
 * A run aborted with it writes no end, so boot can tell the cut from a stop (#981).
 */
export const SHUTDOWN_REASON = "prismalens-shutdown";

export function isShutdown(signal: AbortSignal | undefined): boolean {
	return signal?.aborted === true && signal.reason === SHUTDOWN_REASON;
}

/** How an ask the abort closed reads: PrismaLens restarting is not a stop. */
export const abortOutcome = (signal: AbortSignal | undefined) =>
	isShutdown(signal) ? ("restarted" as const) : ("stopped" as const);

export function deny(
	req: PermissionRequest,
	outcome: Exclude<PermissionAskOutcome, "approved" | "allowed">,
	why: string,
): PermissionDecision {
	const reject = optionOf(req, "reject");
	return {
		allow: false,
		why,
		outcome,
		...(reject ? { optionId: reject.optionId } : {}),
	};
}

/** For a session no prompt ever reaches (the readiness check): every ask is refused. */
export const denyAllPolicy: PermissionPolicy = (req) =>
	deny(req, "denied", "no one can answer an ask here");

/** An alert-started run: nobody is there, so an ask is refused at once, never approved (#818 w5-29). */
export const unattendedPolicy: PermissionPolicy = (req) =>
	deny(
		req,
		"unattended",
		"an alert started this run and nobody was there to answer",
	);

const READS = new Set(["read", "search"]);
const FILE_CHANGES = new Set(["edit", "delete", "move"]);

/** The agent's allow option as PrismaLens's own answer; the card when it offered none. */
function allowed(
	req: PermissionRequest,
	ctx: AskContext,
	card: PermissionPolicy,
): PermissionDecision | Promise<PermissionDecision> {
	// Once-only first, so an approval never becomes a standing rule in the agent.
	const allow = optionOf(req, "allow");
	if (!allow) return card(req, ctx);
	return { allow: true, optionId: allow.optionId, outcome: "allowed" };
}

/** An ask a person answered "Always allow" on: its kind and the operation's identity. */
export interface RememberedAsk {
	kind: string | null;
	identity: string;
}

const FILE_KINDS = new Set(["edit", "delete", "move"]);

class Unserializable extends Error {}

/**
 * JSON with keys sorted, so the same input always names the same operation. Arrays keep
 * their elements as they are; a cycle or a value JSON cannot hold throws Unserializable.
 */
function stable(v: unknown, seen = new Set<unknown>()): string {
	if (v === null) return "null";
	switch (typeof v) {
		case "string":
		case "boolean":
			return JSON.stringify(v);
		case "number":
			if (!Number.isFinite(v)) throw new Unserializable();
			return JSON.stringify(v);
		case "object": {
			if (seen.has(v)) throw new Unserializable();
			seen.add(v);
			const out = Array.isArray(v)
				? `[${v.map((x) => stable(x, seen)).join(",")}]`
				: `{${Object.keys(v as object)
						.filter((k) => (v as Record<string, unknown>)[k] !== undefined)
						.sort()
						.map(
							(k) =>
								`${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k], seen)}`,
						)
						.join(",")}}`;
			seen.delete(v);
			return out;
		}
		default:
			throw new Unserializable();
	}
}

/**
 * What an ask would do, as a hash of its whole input as given (an argv stays an array), every
 * location in order, and, for a tool that is not a command or file change, its name; never
 * the title alone. Null when nothing names it or it cannot be serialized (#1020, CP4 OBJ-011).
 */
export function askIdentity(
	tc: PermissionRequest["toolCall"] | undefined,
): string | null {
	if (!tc) return null;
	const kind = tc.kind ?? null;
	const raw =
		tc.rawInput && typeof tc.rawInput === "object"
			? (tc.rawInput as Record<string, unknown>)
			: {};
	const locations = (tc.locations ?? []).map((l) => l.path ?? null);
	if (kind === "execute") {
		const cmd = raw.command;
		const named =
			(typeof cmd === "string" && cmd.trim() !== "") ||
			(Array.isArray(cmd) && cmd.length > 0);
		if (!named) return null;
	} else if (kind && FILE_KINDS.has(kind)) {
		const path = raw.file_path ?? raw.path ?? raw.abs_path;
		if (typeof path !== "string" && !locations.some(Boolean)) return null;
	} else if (Object.keys(raw).length === 0) return null;
	const command = kind === "execute" || (kind !== null && FILE_KINDS.has(kind));
	try {
		return createHash("sha256")
			.update(
				stable({
					kind,
					raw,
					locations,
					...(command ? {} : { tool: tc.title ?? null }),
				}),
			)
			.digest("hex");
	} catch (e) {
		if (e instanceof Unserializable) return null;
		throw e;
	}
}

function isRemembered(
	req: PermissionRequest,
	remembered: readonly RememberedAsk[] | undefined,
): boolean {
	if (!remembered?.length) return false;
	const identity = askIdentity(req.toolCall);
	if (!identity) return false;
	const kind = req.toolCall?.kind ?? null;
	return remembered.some((a) => a.identity === identity && a.kind === kind);
}

/** The run's gateway as the policy sees it: connected, its server name, and PrismaLens's own tool names. */
export interface GatewayAsks {
	connected(): boolean;
	serverName: string;
	tools: readonly string[];
	/** The tools answered without a card: those that only read or write the run's own record (#848). */
	autoAllow?: readonly string[];
}

/**
 * The MCP server and tool an ask names; null unless the agent's own `_meta` marks an MCP call.
 * Titles and rawInput can carry the call's own arguments, so rawInput only narrows (#848).
 */
function namedTool(
	tc: NonNullable<PermissionRequest["toolCall"]>,
): { servers: string[]; tool: string } | null {
	const meta = tc._meta as
		| {
				claudeCode?: { mcpServer?: { name?: unknown } };
				is_mcp_tool_call?: unknown;
		  }
		| undefined;
	const server = meta?.claudeCode?.mcpServer?.name;
	const title = tc.title ?? "";
	const qualified =
		typeof server === "string"
			? /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(title)
			: meta?.is_mcp_tool_call === true
				? /^mcp\.([^.]+)\.(.+)$/.exec(title)
				: null;
	if (!qualified?.[1] || !qualified[2]) return null;
	const servers = [qualified[1]];
	if (typeof server === "string") servers.push(server);
	const raw = tc.rawInput as { server?: unknown } | undefined;
	if (typeof raw?.server === "string") servers.push(raw.server);
	return { servers, tool: qualified[2] };
}

/**
 * True only for a call to one of PrismaLens's own read-only tools on our confirmed
 * server; another server's tool of the same name never matches (#848, OBJ-011).
 */
export function isGatewayToolCall(
	req: PermissionRequest,
	gateway: GatewayAsks | undefined,
): boolean {
	if (!gateway?.connected() || !req.toolCall) return false;
	const named = namedTool(req.toolCall);
	return (
		!!named &&
		named.servers.every((s) => s === gateway.serverName) &&
		(gateway.autoAllow ?? gateway.tools).includes(named.tool)
	);
}

/**
 * How the run's level answers an ask, in this order (#673 w21 ruling 2026-10-10):
 * a request to switch mode is refused at every level; PrismaLens's own read-only
 * tools on the confirmed gateway run; reads and searches run;
 * Ask always shows the card; Auto-accept edits approves file changes and shows
 * the rest; Auto and Full access approve. A sync verdict never shows a card.
 */
export function levelPolicy(
	level: AccessLevel,
	channel: { policy: PermissionPolicy },
	opts: {
		unattended?: boolean;
		/** Wait for me: every ask past reads goes to a person, never answered by the level (#1020). */
		waitForAsks?: boolean;
		gateway?: GatewayAsks;
		/** Asks a person allowed always on this schedule; matched on kind and title exactly (#1020). */
		remembered?: readonly RememberedAsk[];
	} = {},
): PermissionPolicy {
	const card = opts.unattended ? unattendedPolicy : channel.policy;
	return (req, ctx) => {
		const kind = req.toolCall?.kind;
		if (kind === "switch_mode")
			return deny(req, "mode_kept", "the run stays in its mode");
		if (isGatewayToolCall(req, opts.gateway)) return allowed(req, ctx, card);
		if (kind && READS.has(kind)) return allowed(req, ctx, card);
		// Only the exact operation a person allowed; anything else goes on to the card below.
		if (isRemembered(req, opts.remembered)) return allowed(req, ctx, card);
		if (opts.unattended || opts.waitForAsks || level === "supervised")
			return card(req, ctx);
		if (level === "auto-edits")
			return kind && FILE_CHANGES.has(kind)
				? allowed(req, ctx, card)
				: card(req, ctx);
		return allowed(req, ctx, card);
	};
}

/** What the conversation and the row show of an ask that waits. */
export interface PendingAsk {
	askId: string;
	askedAt: Date;
	expiresAt: Date;
}

/** How an answered ask ended, and a deny's reason, which the host queues to the session. */
export interface AskResult {
	outcome: "approved" | "denied" | "answered" | "declined";
	reason?: string;
}

/** A non-permission ask the channel holds: an elicitation, or a PrismaLens tool's ask (#1024). */
export interface HeldAsk {
	kind: "question" | "input" | "permission" | "secret";
	/** Checked before it settles; false answers the caller with a 409. */
	accepts(answer: AskAnswer): boolean;
}

/** How a held ask ended: its answer, or why none came. */
export type HeldOutcome =
	| {
			outcome: "answered" | "approved" | "denied" | "declined";
			answer: AskAnswer;
	  }
	| { outcome: "expired" | "stopped" | "restarted" | "unattended" };

export interface AskChannel {
	policy: PermissionPolicy;
	/** The operator's answer; null when no ask by that id waits, `invalid` when it does not fit (the ask stays open). */
	answer(askId: string, answer: AskAnswer): AskResult | "invalid" | null;
	/**
	 * Hold an ask until it is answered, its window lapses (`expired`) or the run ends.
	 * `timeoutMs <= 0` never lapses.
	 */
	hold(
		askId: string,
		ask: HeldAsk,
		ctx: { signal?: AbortSignal; timeoutMs: number },
	): Promise<HeldOutcome>;
	/** The asks still waiting, oldest first. */
	pending(): PendingAsk[];
	/** The run ended: every waiting ask is refused as `stopped`. */
	close(): void;
}

/**
 * The host side of the ask lifecycle: each ask waits for {@link AskChannel.answer},
 * the turn's cancel, or `timeoutMs`, whichever comes first. `onChange` hears the
 * oldest waiting ask's time, or null once none waits, so the row can show it.
 */
export function createAskChannel(
	opts: {
		timeoutMs?: number;
		onChange?: (oldest: Date | null) => void;
		now?: () => Date;
	} = {},
): AskChannel {
	const timeoutMs = opts.timeoutMs ?? ASK_TIMEOUT_MS;
	const now = opts.now ?? (() => new Date());
	const waiting = new Map<
		string,
		PendingAsk & {
			req: PermissionRequest;
			settle: (d: PermissionDecision) => void;
		}
	>();
	const held = new Map<
		string,
		PendingAsk & { ask: HeldAsk; settle: (o: HeldOutcome) => void }
	>();
	let closed = false;
	const changed = () => {
		const oldest = [...waiting.values(), ...held.values()]
			.map((w) => w.askedAt)
			.sort((a, b) => a.getTime() - b.getTime())[0];
		opts.onChange?.(oldest ?? null);
	};

	const policy: PermissionPolicy = (req, ctx) => {
		if (closed) return deny(req, "stopped", "the run ended");
		const windowMs = ctx.timeoutMs ?? timeoutMs;
		if (windowMs <= 0)
			return deny(req, "timed_out", "the run's time limit was reached");
		return new Promise<PermissionDecision>((resolve) => {
			const askedAt = now();
			const settle = (d: PermissionDecision) => {
				if (!waiting.delete(ctx.askId)) return;
				clearTimeout(timer);
				ctx.signal.removeEventListener("abort", onAbort);
				resolve(d);
				changed();
			};
			const onAbort = () =>
				settle(
					isShutdown(ctx.signal)
						? deny(req, "restarted", "PrismaLens restarted")
						: deny(req, "stopped", "the turn was stopped"),
				);
			const timer = setTimeout(
				() =>
					settle(
						deny(
							req,
							"timed_out",
							ctx.clamped
								? "no answer before the run's time limit"
								: `no answer in ${Math.round(windowMs / 60_000)} minutes`,
						),
					),
				windowMs,
			);
			timer.unref?.();
			waiting.set(ctx.askId, {
				askId: ctx.askId,
				askedAt,
				expiresAt: new Date(askedAt.getTime() + windowMs),
				req,
				settle,
			});
			changed();
			if (ctx.signal.aborted) onAbort();
			else ctx.signal.addEventListener("abort", onAbort, { once: true });
		});
	};

	return {
		policy,
		answer(askId, answer) {
			const kept = held.get(askId);
			if (kept) {
				if (!kept.ask.accepts(answer)) return "invalid";
				const outcome =
					answer.kind === "decline"
						? "declined"
						: answer.kind === "permission"
							? answer.decision === "approve"
								? "approved"
								: "denied"
							: "answered";
				kept.settle({ outcome, answer });
				return {
					outcome,
					...(answer.kind === "permission" && answer.reason
						? { reason: answer.reason }
						: {}),
				};
			}
			const entry = waiting.get(askId);
			if (!entry || answer.kind !== "permission") return null;
			const approve = answer.decision === "approve";
			// The answer goes back as one of the agent's own options (ACP session/request_permission).
			const allow = approve
				? ((answer.scope === "always"
						? entry.req.options.find((o) => o.kind === "allow_always")
						: undefined) ?? optionOf(entry.req, "allow"))
				: undefined;
			entry.settle(
				allow
					? { allow: true, optionId: allow.optionId, outcome: "approved" }
					: deny(
							entry.req,
							"denied",
							approve ? "the agent offered no allow option" : "you denied it",
						),
			);
			return allow
				? { outcome: "approved" }
				: {
						outcome: "denied",
						...(!approve && answer.reason ? { reason: answer.reason } : {}),
					};
		},
		hold(askId, ask, ctx) {
			if (closed) return Promise.resolve({ outcome: "stopped" });
			return new Promise<HeldOutcome>((resolve) => {
				const askedAt = now();
				let timer: ReturnType<typeof setTimeout> | undefined;
				const settle = (o: HeldOutcome) => {
					if (!held.delete(askId)) return;
					if (timer) clearTimeout(timer);
					ctx.signal?.removeEventListener("abort", onAbort);
					resolve(o);
					changed();
				};
				const onAbort = () =>
					settle({
						outcome:
							ctx.signal && isShutdown(ctx.signal) ? "restarted" : "stopped",
					});
				if (ctx.timeoutMs > 0) {
					timer = setTimeout(
						() => settle({ outcome: "expired" }),
						ctx.timeoutMs,
					);
					timer.unref?.();
				}
				held.set(askId, {
					askId,
					askedAt,
					// No window: the latest date a Date holds, not a sum past it.
					expiresAt:
						ctx.timeoutMs > 0
							? new Date(askedAt.getTime() + ctx.timeoutMs)
							: new Date(8.64e15),
					ask,
					settle,
				});
				changed();
				if (ctx.signal?.aborted) onAbort();
				else ctx.signal?.addEventListener("abort", onAbort, { once: true });
			});
		},
		pending: () =>
			[...waiting.values(), ...held.values()]
				.map(({ askId, askedAt, expiresAt }) => ({ askId, askedAt, expiresAt }))
				.sort((a, b) => a.askedAt.getTime() - b.askedAt.getTime()),
		close() {
			closed = true;
			for (const entry of [...waiting.values()])
				entry.settle(deny(entry.req, "stopped", "the run ended"));
			for (const entry of [...held.values()])
				entry.settle({ outcome: "stopped" });
		},
	};
}

/** A fresh ask id. */
export const newAskId = (): string => randomUUID();
