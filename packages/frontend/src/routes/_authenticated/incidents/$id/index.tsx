/**
 * The incident page (#743 §3c, layer 1): one column of bounded cards under
 * the pinned band and run strip, and the box fixed at the bottom. Nothing on
 * the page grows; each card links to the route that holds the rest.
 */
import { createFileRoute } from "@tanstack/react-router";
import { CardStack } from "@/components/incidents/cards/CardStack";
import { DockedComposer } from "@/components/investigation/DockedComposer";

export const Route = createFileRoute("/_authenticated/incidents/$id/")({
	component: IncidentPage,
});

function IncidentPage() {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				className="min-h-0 flex-1 overflow-y-auto"
				data-testid="incident-record"
			>
				<div className="mx-auto flex max-w-[46rem] flex-col gap-3 px-4 py-4 sm:px-6">
					<CardStack />
				</div>
			</div>
			<DockedComposer />
		</div>
	);
}
