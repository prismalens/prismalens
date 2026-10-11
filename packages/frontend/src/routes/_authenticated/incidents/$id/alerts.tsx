/**
 * The old Alerts tab (#811): its content lives on the overview now, so the
 * URL lands there.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/incidents/$id/alerts")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/incidents/$id",
			params: { id: params.id },
			replace: true,
		});
	},
});
