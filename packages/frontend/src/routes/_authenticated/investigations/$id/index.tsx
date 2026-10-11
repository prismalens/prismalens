/**
 * A run has no page of its own: it lives under its incident (#599, #523). This
 * route keeps old deep links working by sending them to its page (#743), a
 * `#step-N` with them (#811). Redirecting in beforeLoad: a rendered <Navigate>
 * here hung the page (#814).
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/_authenticated/investigations/$id/")({
	beforeLoad: async ({ context, params, location }) => {
		const run = await context.queryClient
			.fetchQuery(
				orpc.investigations.get.queryOptions({ input: { id: params.id } }),
			)
			.catch(() => null);
		if (!run) throw redirect({ to: "/incidents", replace: true });
		throw redirect({
			to: "/incidents/$id/conversation",
			params: { id: run.incidentId },
			search: { investigation: params.id },
			hash: location.hash || undefined,
			replace: true,
		});
	},
});
