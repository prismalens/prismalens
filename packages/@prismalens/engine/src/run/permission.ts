// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * PrismaLens never answers an agent's permission ask itself: the agent's own
 * mode decides what it asks, and every ask waits on the operator's Approve or
 * Deny (#673 w21, operator ruling 2026-10-09). Nobody answering denies it.
 */
import { randomUUID } from "node:crypto";
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
	| { allow: true; optionId: string; outcome: "approved"; warn?: string }
	| {
			allow: false;
			optionId?: string;
			why: string;
			outcome: Exclude<PermissionAskOutcome, "approved">;
	  };

/** One ask: `askId` names it in the conversation; `signal` aborts when the turn is cancelled. */
export interface AskContext {
	askId: string;
	signal: AbortSignal;
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
	outcome: Exclude<PermissionAskOutcome, "approved">,
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
							`no answer in ${Math.round(timeoutMs / 60_000)} minutes`,
						),
					),
				timeoutMs,
			);
			timer.unref?.();
			waiting.set(ctx.askId, {
				askId: ctx.askId,
				askedAt,
				expiresAt: new Date(askedAt.getTime() + timeoutMs),
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
