/**
 * A run has no page of its own: it lives under its incident (#599, #523). This
 * route keeps old deep links working by sending them to its page (#743), a
 * `#step-N` with them (#811). Redirecting in beforeLoad: a rendered <Navigate>
 * here hung the page (#814).
 */
import {
	createFileRoute,
	Link,
	notFound,
	redirect,
} from "@tanstack/react-router";
import { NotFound } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/api/orpc-client";
import { isNotFound } from "@/lib/not-found";

export const Route = createFileRoute("/_authenticated/investigations/$id/")({
	validateSearch: (search: Record<string, unknown>): { ask?: string } =>
		typeof search.ask === "string" ? { ask: search.ask } : {},
	beforeLoad: async ({ context, params, location, search }) => {
		const run = await context.queryClient
			.fetchQuery(
				orpc.investigations.get.queryOptions({ input: { id: params.id } }),
			)
			.catch((error: unknown) => {
				// An unknown address says so, as an unknown incident does (#831 w6-33).
				if (isNotFound(error, params.id)) throw notFound();
				throw error;
			});
		throw redirect({
			to: "/incidents/$id/conversation",
			params: { id: run.incidentId },
			search: {
				investigation: params.id,
				...(search.ask ? { ask: search.ask } : {}),
			},
			hash: location.hash || undefined,
			replace: true,
		});
	},
	notFoundComponent: RunNotFound,
});

function RunNotFound() {
	return (
		<div className="px-4 pt-6 sm:px-6">
			<NotFound
				text="No run has this address. It may have been deleted, or the link is wrong."
				back={
					<Button variant="text" size="sm" asChild>
						<Link to="/incidents">Back to the inbox</Link>
					</Button>
				}
			/>
		</div>
	);
}
