/**
 * The Overview tab (#743): a few sentences on where the incident stands and
 * the next step, then bounded cards; from 88rem wide, what the agent found on
 * the left and what the alerts and people did on the right. The box sits at
 * the bottom.
 */
import { createFileRoute } from "@tanstack/react-router";
import { AlertsCard } from "@/components/incidents/cards/AlertsCard";
import { ConclusionCard } from "@/components/incidents/cards/ConclusionCard";
import { DetailsCard } from "@/components/incidents/cards/DetailsCard";
import { NeedsYouCard } from "@/components/incidents/cards/NeedsYouCard";
import { RunCard } from "@/components/incidents/cards/RunCard";
import { SummaryBlock } from "@/components/incidents/cards/SummaryBlock";
import { TimelineCard } from "@/components/incidents/cards/TimelineCard";
import { DockedComposer } from "@/components/investigation/DockedComposer";

export const Route = createFileRoute("/_authenticated/incidents/$id/")({
	component: IncidentPage,
});

const WIDTH = "max-w-3xl min-[88rem]:max-w-[76rem]";

function IncidentPage() {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				className="min-h-0 flex-1 overflow-y-auto"
				data-testid="incident-record"
			>
				<div
					className={`mx-auto flex flex-col gap-3 px-4 py-4 sm:px-6 ${WIDTH}`}
				>
					<SummaryBlock />
					<div className="grid grid-cols-1 items-start gap-3 min-[88rem]:grid-cols-2">
						<div className="flex flex-col gap-3">
							<NeedsYouCard />
							<RunCard />
							<ConclusionCard />
						</div>
						<div className="flex flex-col gap-3">
							<AlertsCard />
							<TimelineCard />
							<DetailsCard />
						</div>
					</div>
				</div>
			</div>
			<DockedComposer width={WIDTH} />
		</div>
	);
}
