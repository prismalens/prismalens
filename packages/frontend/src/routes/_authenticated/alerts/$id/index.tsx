/**
 * One alert's record, the centre of the alerts frame (#523 S3, the study's M2).
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
