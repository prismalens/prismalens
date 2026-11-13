// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import { isBlockedMode } from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAgentChoice } from "@/components/agent/AgentPicker";
import { openNewThread } from "@/components/thread/composer/quote";
import {
	autoResumeBody,
	LimitDock,
	type SwitchChoices,
} from "@/components/thread/session/LimitDock";
import {
	ConnectionDock,
	InterruptedDock,
} from "@/components/thread/session/StopDocks";
import {
	useInvestigation,
	useResumeInvestigation,
} from "@/lib/api/hooks/use-investigations-orpc";
import {
	useRetryNow,
	useSetAutoResume,
} from "@/lib/api/hooks/use-session-orpc";
import { getErrorMessage } from "@/lib/get-error-message";
import { accountPage, stopMode } from "@/lib/provider-stop";
import { notResumedReason } from "@/lib/restart";
import { DOCK_ORDER, type LaneSlots, type SlotContext } from "./types";

/** The note a switch sends with the other model: the agent picks the interrupted turn up. */
const SWITCH_NOTE = "Continue where you left off.";

/**
 * UI 3's page slots (#1024, #1101): the provider-stop dock (usage limit, rate limit,
 * busy provider, Blocked), Interrupted by restart, and the quiet connection dock.
 * Only UI 3 edits this file.
 */
export function useAppSlots(ctx: SlotContext): LaneSlots {
	const { threadId, live } = ctx;
	const inv = useInvestigation(threadId ?? "").data;
	const { harnesses } = useAgentChoice();
	const navigate = useNavigate();
	const autoResume = useSetAutoResume(threadId ?? "");
	const retry = useRetryNow(threadId ?? "");
	const resume = useResumeInvestigation();
	const [resumeError, setResumeError] = useState<string | null>(null);
	const limit = !live && threadId ? inv?.session?.limit : undefined;
	const agent = harnesses.find((h) => h.id === inv?.harness);
	const choices: SwitchChoices = {
		// Another model continues here only where the page can send (the thread page).
		models: (ctx.send ? (agent?.models.entries ?? []) : [])
			.filter((m) => m.id !== inv?.model)
			.slice(0, 8)
			.map((m) => ({ id: m.id, label: m.name })),
		agents: harnesses
			.filter((h) => h.runnable && h.id !== inv?.harness)
			.map((h) => ({ id: h.id, label: h.label })),
	};
	const mode = limit ? stopMode(limit) : null;
	const pending = autoResume.isPending || retry.isPending;
	const stopDock = limit && (
		<LimitDock
			limit={limit}
			draft={ctx.draft}
			pending={pending}
			onDontResume={() => autoResume.mutate(autoResumeBody.dontResume())}
			onSendAtReset={(m) => autoResume.mutate(autoResumeBody.sendAtReset(m))}
			onResumeAtReset={() => autoResume.mutate(autoResumeBody.resumeAtReset())}
			onRemoveQueued={() =>
				autoResume.mutate(autoResumeBody.removeQueued(limit.autoResume))
			}
			onSend={() => retry.mutate()}
			onRetryNow={() => retry.mutate()}
			onUpdateKey={() =>
				void navigate({
					to: "/settings",
					search: {
						tab: "agent",
						agent: (inv?.harness ?? undefined) as HarnessId | undefined,
					},
				})
			}
			accountUrl={
				mode && isBlockedMode(mode)
					? accountPage(
							inv?.harness,
							mode === "spend_cap" ? "limits" : "billing",
							inv?.model,
						)
					: null
			}
			switchChoices={choices}
			onSwitchModel={(model) => void ctx.send?.(SWITCH_NOTE, { model })}
			onSwitchAgent={(id) =>
				openNewThread({
					quotes: [],
					references: [],
					harness: id as HarnessId,
				})
			}
		/>
	);
	// The incident run page has its own Interrupted line and Resume.
	const interrupted =
		ctx.page === "thread" &&
		!live &&
		!!threadId &&
		inv?.status === "failed" &&
		inv.endReason === "interrupted";
	const interruptedDock = interrupted && inv && (
		<InterruptedDock
			notResumed={notResumedReason(inv.error)}
			pending={resume.isPending}
			error={resumeError}
			onResume={() => {
				setResumeError(null);
				resume.mutate(
					{ id: inv.id },
					{ onError: (e) => setResumeError(getErrorMessage(e)) },
				);
			}}
		/>
	);
	return {
		dock: [
			{
				id: "connection",
				order: DOCK_ORDER.connection,
				node: <ConnectionDock />,
			},
			stopDock
				? { id: "usage-limit", order: DOCK_ORDER.usageLimit, node: stopDock }
				: null,
			interruptedDock
				? {
						id: "interrupted",
						order: DOCK_ORDER.interrupted,
						node: interruptedDock,
					}
				: null,
		],
	};
}
