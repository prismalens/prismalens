// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useRef, useState } from "react";
import {
	DOCK_ORDER,
	type LaneSlots,
	type SlotContext,
} from "@/components/thread/slots/types";
import { useHarnessSettings } from "@/lib/api/hooks";
import { useInvestigation } from "@/lib/api/hooks/use-investigations-orpc";
import {
	useCompactSession,
	useSetAutoResume,
} from "@/lib/api/hooks/use-session-orpc";
import type {
	SendEnvelope,
	SendForward,
	SendInterceptor,
} from "@/lib/composer-send";
import { useContextMeterSignal } from "@/lib/context-meter";
import { getErrorMessage } from "@/lib/get-error-message";
import { type ColdChoice, ColdDock, coldSendFields } from "./ColdDock";
import { ContextMeter } from "./ContextMeter";
import { autoResumeBody, LimitDock } from "./LimitDock";
import { needsColdPrompt, type ThreadLimit } from "./session-words";

type Held = {
	env: SendEnvelope;
	forward: SendForward;
	now: boolean;
	settle: (r: "sent" | "cancelled") => void;
};

function hold(
	setHeld: (h: Held | null) => void,
	env: SendEnvelope,
	now: boolean,
	forward: SendForward,
) {
	let settle: Held["settle"] = () => {};
	const settled = new Promise<"sent" | "cancelled">((r) => {
		settle = r;
	});
	setHeld({ env, forward, now, settle });
	return { result: "deferred" as const, settled };
}

/**
 * The context meter in the composer footer, and the two docks: a usage limit,
 * and a send into a conversation gone cold. Both docks hold the draft until a choice.
 */
export function useSessionSlots(ctx: SlotContext): LaneSlots {
	const id = ctx.threadId ?? "";
	const { data: run } = useInvestigation(id);
	const { data: settings } = useHarnessSettings();
	const compact = useCompactSession(id);
	const autoResume = useSetAutoResume(id);
	const [cold, setCold] = useState<Held | null>(null);
	const [limited, setLimited] = useState<Held | null>(null);
	const [error, setError] = useState<string | null>(null);

	const signal = useContextMeterSignal();
	const [meterOpen, setMeterOpen] = useState(false);
	const first = useRef(signal);
	useEffect(() => {
		if (signal !== first.current) setMeterOpen(true);
	}, [signal]);

	const session = run?.session ?? null;
	const limit = (session?.limit ?? null) as ThreadLimit | null;
	const coldMode = settings?.coldResume ?? "ask";

	// Read through a ref so the interceptor the composer holds never goes stale.
	const state = useRef({ session, limit, coldMode, live: ctx.live });
	state.current = { session, limit, coldMode, live: ctx.live };

	const interceptor: SendInterceptor = (env, now, forward) => {
		const s = state.current;
		if (!id || s.live || !s.session) return null;
		if (s.limit && !s.limit.gaveUp) return hold(setLimited, env, now, forward);
		if (env.compact || env.fresh) return null;
		if (!needsColdPrompt(s.session, new Date())) return null;
		if (s.coldMode === "send") return null;
		if (s.coldMode === "compact" && s.session.compactCommand)
			return forward({ ...env, compact: true }, now).then(() => ({
				result: "sent" as const,
			}));
		return hold(setCold, env, now, forward);
	};

	const release = async (
		held: Held,
		setHeld: (h: Held | null) => void,
		env: SendEnvelope | null,
	) => {
		setError(null);
		try {
			if (env) await held.forward(env, held.now);
			held.settle(env ? "sent" : "cancelled");
			setHeld(null);
		} catch (e) {
			setError(getErrorMessage(e));
		}
	};

	const chooseCold = (choice: ColdChoice) =>
		cold &&
		void release(cold, setCold, { ...cold.env, ...coldSendFields(choice) });

	const usage = run?.usage;
	return {
		composerFooter:
			usage && usage.size > 0 ? (
				<ContextMeter
					usage={usage}
					session={session}
					open={meterOpen}
					onOpenChange={setMeterOpen}
					running={ctx.live}
					compacting={compact.isPending}
					onCompact={(focus) =>
						compact.mutate(focus, { onSuccess: () => setMeterOpen(false) })
					}
				/>
			) : null,
		interceptor,
		dock: [
			limit
				? {
						id: "usage-limit",
						order: DOCK_ORDER.usageLimit,
						node: (
							<LimitDock
								limit={limit}
								draft={limited?.env.text}
								pending={autoResume.isPending}
								onDontResume={() =>
									autoResume.mutate(autoResumeBody.dontResume())
								}
								onSendAtReset={(message) =>
									autoResume.mutate(autoResumeBody.sendAtReset(message), {
										onSuccess: () => {
											limited?.settle("sent");
											setLimited(null);
										},
									})
								}
								onSendNow={
									limited
										? () => void release(limited, setLimited, limited.env)
										: undefined
								}
							/>
						),
					}
				: null,
			cold && session
				? {
						id: "cold-conversation",
						order: DOCK_ORDER.coldConversation,
						node: (
							<>
								<ColdDock
									tokens={session.contextTokens ?? 0}
									canCompact={!!session.compactCommand}
									onChoose={chooseCold}
									onCancel={() => void release(cold, setCold, null)}
								/>
								{error && (
									<p className="text-meta text-danger" role="alert">
										{error}
									</p>
								)}
							</>
						),
					}
				: null,
		],
	};
}
