/**
 * Investigations live on their incident now (#599). Old links land here and
 * are forwarded to the incident screen's Investigation tab.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { InvestigationDetailSkeleton } from "@/components/investigation/InvestigationDetailSkeleton";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/_authenticated/investigations/$id/")({
	component: InvestigationRedirect,
});

function InvestigationRedirect() {
	const { id } = Route.useParams();
	const { data, isLoading, error } = useQuery(
		orpc.investigations.get.queryOptions({ input: { id } }),
	);
	if (isLoading) return <InvestigationDetailSkeleton />;
	if (error || !data) {
		return (
			<div className="flex flex-col items-center justify-center py-12">
				<p className="text-lg font-medium text-destructive">
					Investigation not found
				</p>
				<p className="text-sm text-muted-foreground">{error?.message ?? id}</p>
			</div>
		);
	}
	return (
		<Navigate
			to="/incidents/$id"
			params={{ id: data.incidentId }}
			search={{ tab: "investigation", investigation: id }}
			replace
		/>
	);
}
