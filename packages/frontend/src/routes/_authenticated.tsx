/**
 * Authenticated Layout Route
 *
 * This pathless layout route protects all child routes by checking if setup is complete.
 * If setup is not complete, users are redirected to /setup with a redirect parameter
 * so they can return to their intended destination after completing setup.
 *
 * Uses TanStack Query's ensureQueryData with built-in retry logic to handle
 * transient network errors during SSR cold starts.
 */

import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { isRedirect } from "@tanstack/react-router";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async ({ context, location }) => {
		try {
			// Use TanStack Query's ensureQueryData with built-in retry logic
			// This handles transient network errors during SSR cold starts
			const result = await context.queryClient.ensureQueryData(
				orpc.setup.getStatus.queryOptions({ input: {} }),
			);

			if (result.setupComplete) {
				return; // Setup complete, allow access to protected routes
			}

			// Setup not complete - redirect to setup with original URL
			throw redirect({
				to: "/setup",
				search: {
					redirect: location.href,
					callback: false,
					provider: undefined,
					success: undefined,
				},
			});
		} catch (error) {
			// If it's already a redirect, rethrow it
			if (isRedirect(error)) {
				throw error;
			}
			// Let other errors bubble up to the error boundary
			// Don't redirect to setup on network errors - that was the bug!
			throw error;
		}
	},
	component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
	return <Outlet />;
}
