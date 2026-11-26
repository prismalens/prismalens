// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import { useNavigate } from "@tanstack/react-router";
import type { NeedsCtx } from "@/components/home/needs.actions";
import { causeOf, stopOf } from "@/components/home/needs-cause";
import { agentFacts } from "@/lib/agent-facts";
import { useResumeInvestigation } from "@/lib/api/hooks/use-investigations-orpc";
import { useRetryNow } from "@/lib/api/hooks/use-session-orpc";
import { signInCommand } from "@/lib/failure-words";
import { accountLink } from "@/lib/provider-stop";
import { stopCause } from "@/lib/stop-causes";
import type { ListNode } from "@/lib/thread-list";
import { threadLink } from "@/lib/thread-rows";

/** The context a card's registered fix actions run with. */
export function useNeedsCtx(node: ListNode, answer: () => void): NeedsCtx {
	const navigate = useNavigate();
	const retry = useRetryNow(node.id);
	const resume = useResumeInvestigation();
	const t = node.thread;
	const cause = causeOf(node);
	const stop = stopOf(node);
	const view = stop ? stopCause(stop) : null;
	const link = view?.account
		? accountLink(t.harness, view.account.page, t.model)
		: null;
	const url = link?.url ?? null;
	const command = signInCommand(agentFacts(t.harness)?.loginHint);
	return {
		answer,
		updateKey: () =>
			void navigate({
				to: "/settings",
				search: {
					tab: "agent",
					agent: (t.harness ?? undefined) as HarnessId | undefined,
				},
			}),
		account: () => {
			if (url) window.open(url, "_blank", "noopener");
		},
		accountLabel: link?.label ?? "",
		signInCommand: command,
		freeSpace: () =>
			void navigate({ to: "/settings", search: { tab: "runs" } }),
		retryNow: () => retry.mutate(),
		resume: () => resume.mutate({ id: node.id }),
		open: () => void navigate(threadLink(t)),
		facts: {
			is: {
				ask: node.info.status === "approval" || node.info.status === "question",
				key: view?.fix === "needs.updateKey",
				credit: !!url && view?.fix === "needs.addCredit",
				cap: !!url && view?.fix === "needs.raiseCap",
				busy: retry.isPending || resume.isPending,
				disk: cause === "disk_full",
				signIn: cause === "sign_in" && !!command,
				interrupted: node.info.status === "interrupted",
			},
		},
	};
}
