/**
 * One alert's full record (#523 S3, the study's M2): the raw truth the app
 * holds and used to show as a truncated table row. Read-dense, addressable,
 * with one escape hatch to the thing that explains it — the incident it
 * landed on, or the rule holding it down.
 */
import { createFileRoute } from "@tanstack/react-router";
import { AlertDetail } from "@/components/alerts/AlertDetail";

export const Route = createFileRoute("/_authenticated/alerts/$id/")({
	component: AlertDetailPage,
});

function AlertDetailPage() {
	const { id } = Route.useParams();
	return <AlertDetail alertId={id} />;
}
