// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isRunStateLive } from "@prismalens/contracts";
import { useRunAgentModel } from "@/components/incidents/RunStrip";
import { useIncidentRecord } from "@/components/incidents/record-context";
import { useToast } from "@/hooks/use-toast";
import { composerMode } from "@/lib/composer-keys";
import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";
import { ComposerBox } from "./ComposerBox";

/**
 * The box in its one fixed place, the bottom of the incident page and of the
 * conversation (#743): a brief before a run, a message while it runs, a brief
 * for the next run after it ends.
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
	const { run, investigationId } = record;
	const { toast } = useToast();
	const who = useRunAgentModel(run.investigation);
	const live = !!run.state && isRunStateLive(run.state);
	const mode = composerMode(investigationId ? { live } : null);

	return (
		<div
			className={cn("shrink-0 bg-background px-3 pt-1 pb-3", className)}
			data-testid="docked-composer"
		>
			<div className="mx-auto max-w-3xl">
				<ComposerBox
					docked
					mode={mode}
					target={target}
					fixed={who}
					waiting={run.waiting}
					isPending={record.isInvestigating}
					blockedReason={
						!record.canInvestigate && mode !== "live"
							? "Only an open incident can be investigated."
							: record.investigateBlocked
					}
					onInvestigate={(brief) => record.investigate(brief || undefined)}
					onMessage={(text, send) =>
						run.sendMessage(text, send, {
							branchId,
							onError: (error) =>
								toast({
									title: "Message not sent",
									description: getErrorMessage(error),
									variant: "destructive",
								}),
						})
					}
					undeliverable={run.undeliverable}
					onSaveAsNote={(text) => record.addNote(text, run.clearUndeliverable)}
				/>
			</div>
		</div>
	);
}
