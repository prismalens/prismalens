// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A push opened this run for one ask (#859): say where that ask stands now,
 * never whatever ask is current.
 */

import type { AskState } from "@prismalens/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MutationError } from "@/components/shared/MutationError";
import { Button } from "@/components/ui/button";
import { client, orpc } from "@/lib/api/orpc-client";

export function askLinkText(ask: AskState): string {
	const what = ask.title ? `"${ask.title}"` : "this ask";
	switch (ask.state) {
		case "waiting":
			return `The agent is waiting on you to answer ${what}, below.`;
		case "answered":
			return ask.outcome === "approved" || ask.outcome === "denied"
				? `Answered on another device: ${ask.outcome}.`
				: `The run's access level answered ${what}.`;
		case "timed_out":
			return `${what[0]?.toUpperCase()}${what.slice(1)} timed out: nobody answered in time, so it was denied.`;
		case "run_ended":
			return `The run ended before anyone answered ${what}.`;
		case "needed_approval":
			return `This run needed approval for ${what}. An alert started it and nobody was there to answer, so it was refused.`;
		default:
			return "This link names an ask this run does not have.";
	}
}

export function AskLinkNotice({
	investigationId,
	askId,
}: {
	investigationId: string;
	askId: string;
}) {
	const navigate = useNavigate();
	const ask = useQuery(
		orpc.push.askState.queryOptions({ input: { investigationId, askId } }),
	);
	const rerun = useMutation({
		mutationFn: (incidentId: string) =>
			client.investigations.create({ incidentId }),
		onSuccess: (run) =>
			navigate({
				to: "/incidents/$id/conversation",
				params: { id: run.incidentId },
				search: { investigation: run.id },
			}),
	});
	if (!ask.data) return null;
	return (
		<div
			className="mx-auto mt-3 flex max-w-[760px] flex-wrap items-center gap-3 rounded-control bg-surface-2 px-4 py-2 text-meta text-text-2"
			data-testid="ask-link-notice"
			data-state={ask.data.state}
		>
			<p className="min-w-0 flex-1">{askLinkText(ask.data)}</p>
			{ask.data.state === "needed_approval" && (
				<Button
					variant="secondary"
					size="sm"
					disabled={rerun.isPending}
					onClick={() => ask.data && rerun.mutate(ask.data.incidentId)}
				>
					Re-run with approval
				</Button>
			)}
			{rerun.isError && <MutationError error={rerun.error} />}
		</div>
	);
}
