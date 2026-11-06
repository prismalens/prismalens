// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { ArrowLeft } from "lucide-react";
import { SubagentPane } from "@/components/thread/SubagentPane";
import { Button } from "@/components/ui/button";
import type { SubagentView } from "@/lib/subagents";

/** One sub-agent in the run's details panel (#1025), in place of the tabs until Back. */
export function RunSubagentPanel({
	runId,
	agent,
	events,
	live,
	onBack,
	onAskMain,
}: {
	runId: string;
	agent: SubagentView;
	events: readonly CanonicalEvent[];
	live: boolean;
	onBack: () => void;
	onAskMain?: (quote: string) => void;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="run-subagent">
			<div className="relative flex h-9 shrink-0 items-center px-2 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-hairline">
				<Button
					variant="text"
					size="sm"
					onClick={onBack}
					data-testid="run-subagent-back"
				>
					<ArrowLeft className="size-3.5" aria-hidden />
					Back to details
				</Button>
			</div>
			<SubagentPane
				key={agent.sessionId}
				runId={runId}
				agent={agent}
				events={events}
				live={live}
				onAskMain={onAskMain}
			/>
		</div>
	);
}
