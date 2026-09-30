/**
 * The incident page (#743 §3c, layer 1): one column of bounded cards under
 * the pinned band and run strip. Nothing on it grows; each card links to the
 * route that holds the rest.
 */
import { createFileRoute } from "@tanstack/react-router";
import { CardStack } from "@/components/incidents/cards/CardStack";

export const Route = createFileRoute("/_authenticated/incidents/$id/")({
	component: IncidentPage,
});

function IncidentPage() {
	return (
		<div className="h-full overflow-y-auto" data-testid="incident-record">
			<div className="mx-auto flex max-w-[46rem] flex-col gap-3 px-4 py-4 sm:px-6">
				<CardStack />
			</div>
		</div>
	);
}
