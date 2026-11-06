/**
 * An incident thread's address. With a run it opens on the latest run's
 * transcript, the summary above it (#1020); with none, the overview. Redirecting
 * in beforeLoad: a rendered redirect here can lose a race and leave a blank page (#814).
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { OverviewPage } from "@/components/overview/OverviewPage";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/_authenticated/incidents/$id/")({
	beforeLoad: async ({ context, params }) => {
		const incident = await context.queryClient
			.fetchQuery(orpc.incidents.get.queryOptions({ input: { id: params.id } }))
			.catch(() => null);
		const runs = incident?.investigations ?? [];
		const opening = runs.find((r) => r.kind !== "chat") ?? runs[0];
		if (opening)
			throw redirect({
				to: "/incidents/$id/conversation",
				params: { id: params.id },
				search: { investigation: opening.id },
				replace: true,
			});
	},
	component: OverviewPage,
});
