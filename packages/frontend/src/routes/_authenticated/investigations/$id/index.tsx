/**
 * Standalone view of one investigation. The incident screen is where a run
 * normally lives (#599); this route keeps deep links working and renders the
 * same panel, with a way back to the incident.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { InvestigationPanel } from "@/components/investigation/InvestigationPanel";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/_authenticated/investigations/$id/")({
	component: InvestigationDetailPage,
});

function InvestigationDetailPage() {
	const { id } = Route.useParams();
	const { data } = useQuery(
		orpc.investigations.get.queryOptions({ input: { id } }),
	);
	return (
		<div className="space-y-6">
			{data?.incidentId ? (
				<Link
					to="/incidents/$id"
					params={{ id: data.incidentId }}
					search={{ tab: "investigation", investigation: id }}
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					Back to incident
				</Link>
			) : (
				<Link
					to="/incidents"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="h-4 w-4" />
					Back to incidents
				</Link>
			)}
			<InvestigationPanel investigationId={id} />
		</div>
	);
}
