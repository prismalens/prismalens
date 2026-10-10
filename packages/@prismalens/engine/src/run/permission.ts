// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The agent's own mode decides what it asks; the run's permission level
 * answers it (#673 w21 ruling 2026-10-10). At Ask always every ask waits on
 * the operator's Approve or Deny, and nobody answering denies it.
 */
import { randomUUID } from "node:crypto";
import type { AccessLevel } from "@prismalens/config/harness";
import {
	ASK_TIMEOUT_MS,
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
	toolCall?: {
		title?: string;
		toolCallId?: string;
		kind?: string;
		rawInput?: unknown;
		locations?: { path?: string }[];
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

/**
 * How the run's level answers an ask, in this order (#673 w21 ruling 2026-10-10):
 * a request to switch mode is refused at every level; reads and searches run;
 * Ask always shows the card; Auto-accept edits approves file changes and shows
 * the rest; Auto and Full access approve. A sync verdict never shows a card.
 */
export function levelPolicy(
	level: AccessLevel,
	channel: { policy: PermissionPolicy },
): PermissionPolicy {
	const card = channel.policy;
	return (req, ctx) => {
		const kind = req.toolCall?.kind;
		if (kind === "switch_mode")
			return deny(req, "mode_kept", "the run stays in its mode");
		if (kind && READS.has(kind)) return allowed(req, ctx, card);
		if (level === "supervised") return card(req, ctx);
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

export interface AskChannel {
	policy: PermissionPolicy;
	/** The operator's answer; null when no ask by that id waits. */
	answer(askId: string, approve: boolean): "approved" | "denied" | null;
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
	let closed = false;
	const changed = () =>
		opts.onChange?.([...waiting.values()][0]?.askedAt ?? null);

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
				settle(deny(req, "stopped", "the turn was stopped"));
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
		answer(askId, approve) {
			const entry = waiting.get(askId);
			if (!entry) return null;
			// The answer goes back as one of the agent's own options (ACP session/request_permission).
			const allow = approve ? optionOf(entry.req, "allow") : undefined;
			entry.settle(
				allow
					? { allow: true, optionId: allow.optionId, outcome: "approved" }
					: deny(
							entry.req,
							"denied",
							approve ? "the agent offered no allow option" : "you denied it",
						),
			);
			return allow ? "approved" : "denied";
		},
		pending: () =>
			[...waiting.values()].map(({ askId, askedAt, expiresAt }) => ({
				askId,
				askedAt,
				expiresAt,
			})),
		close() {
			closed = true;
			for (const entry of [...waiting.values()])
				entry.settle(deny(entry.req, "stopped", "the run ended"));
		},
	};
}

/** A fresh ask id. */
export const newAskId = (): string => randomUUID();
