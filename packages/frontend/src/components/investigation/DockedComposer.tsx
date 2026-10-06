// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isRunStateLive } from "@prismalens/contracts";
import { useAgentChoice } from "@/components/agent/AgentPicker";
import { useRunAgentModel } from "@/components/incidents/RunStrip";
import { useIncidentRecord } from "@/components/incidents/record-context";
import { useToast } from "@/hooks/use-toast";
import { uploadAttachment } from "@/lib/attachments";
import { type ComposerMode, composerMode } from "@/lib/composer-keys";
import { getErrorMessage } from "@/lib/get-error-message";
import { pinnedTo } from "@/lib/investigation-events";
import { cn } from "@/lib/utils";
import { ComposerBox } from "./ComposerBox";

/** A run that never reached its first prompt because the agent refused its model or effort (R4.2). */
const CONFIG_REFUSED = /would not (switch to|take)|offers no model option/;

/**
 * The box in its one fixed place, the bottom of the incident page and of the
 * conversation (#743): a brief before a run, a message while it runs, then a
 * continue, a follow-up or a new brief, whichever the agent supports (R4.4).
 */
export function DockedComposer({
	branchId,
	target = "the main agent",
	className,
}: {
	branchId?: string;
	target?: string;
	className?: string;
}) {
	const record = useIncidentRecord();
	const { run, investigationId, incident } = record;
	const { toast } = useToast();
	const { harnesses, effective } = useAgentChoice();
	const who = useRunAgentModel(run.investigation);
	const live = !!run.state && isRunStateLive(run.state);
	// A failed run offers a new investigation first (R4.4, the failed report).
	const failed = run.state === "failed";
	const mode = composerMode(
		investigationId
			? {
					live,
					continuable: run.continuable,
					resumable: run.resumable && !failed,
				}
			: null,
	);
	const runHarness = harnesses.find((h) => h.id === run.investigation?.harness);
	const talksTo = mode === "brief" || mode === "again" ? effective : runHarness;
	const agent = {
		label: talksTo?.label ?? who.agent,
		images: talksTo?.checked ? talksTo.checked.images : null,
	};

	const upload = (files: File[]) =>
		Promise.all(files.map((f) => uploadAttachment(incident.id, f)));

	return (
		<div
			className={cn("shrink-0 px-4 pt-1 pb-3 sm:px-6", className)}
			data-testid="docked-composer"
		>
			<ComposerBox
				docked
				mode={mode}
				target={target}
				fixed={who}
				runAccess={run.investigation?.access ?? undefined}
				agent={agent}
				waiting={run.waiting}
				isPending={record.isInvestigating}
				note={noteFor(mode, run, who.agent)}
				stopping={run.stopRequested}
				blockedReason={
					!record.canInvestigate && !live
						? "Only an open incident can be investigated."
						: record.investigateBlocked
				}
				onStop={() =>
					run.stop({
						onError: (error) =>
							toast({
								title: "Stop did not reach the agent",
								description: getErrorMessage(error),
								variant: "destructive",
							}),
					})
				}
				onInvestigate={async ({ text, files, access }) => {
					const attachments = await upload(files);
					await record.investigate({
						brief: text || undefined,
						access,
						attachments: attachments.map((a) => a.id),
					});
				}}
				onMessage={async ({ text, files }, send) => {
					const attachments = await upload(files);
					run.sendMessage(text, send, {
						branchId,
						attachments,
						onError: (error) =>
							toast({
								title: "Message not sent",
								description: getErrorMessage(error),
								variant: "destructive",
							}),
					});
				}}
				undeliverable={run.undeliverable}
				onSaveAsNote={(text) => record.addNote(text, run.clearUndeliverable)}
			/>
		</div>
	);
}

/** The one line above the field (R4.4): what continuing does, or why it cannot. */
function noteFor(
	mode: ComposerMode,
	run: ReturnType<typeof useIncidentRecord>["run"],
	agent: string,
): string | null {
	const pinned = pinnedTo(run.investigation?.workspace);
	const code = pinned ? `the code it saw (${pinned})` : "the workspace it had";
	if (mode === "continue")
		return `Picks up the stopped run on ${code}. ${agent} reopens its own session.`;
	if (mode === "resume")
		return `Follows up in the same session on ${code}. The report stays as it is.`;
	if (mode !== "again") return null;
	const error = run.investigation?.error ?? "";
	if (run.state === "failed" && CONFIG_REFUSED.test(error)) return error;
	return run.resumeBlockedReason;
}
