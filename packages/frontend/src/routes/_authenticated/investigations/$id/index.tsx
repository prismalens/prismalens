/**
 * A run has no page of its own: it lives on its incident's record (#599, #523).
 * This route keeps old deep links working by sending them there.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/_authenticated/investigations/$id/")({
	component: InvestigationRedirect,
});

function InvestigationRedirect() {
	const { id } = Route.useParams();
	const { data, error } = useQuery(
		orpc.investigations.get.queryOptions({ input: { id } }),
	);
	if (error) return <Navigate to="/incidents" replace />;
	if (!data) return <Skeleton className="h-24" />;
	return (
		<Navigate
			to="/incidents/$id"
			params={{ id: data.incidentId }}
			search={{ investigation: id }}
			replace
		/>
	);
}
