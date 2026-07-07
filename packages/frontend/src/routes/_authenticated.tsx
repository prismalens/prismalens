// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Authenticated Layout Route
 *
 * Pathless layout route that protects all child routes:
 * 1. Checks if initial setup is complete — redirects to /setup if not
 * 2. Verifies the user has a valid Better Auth session — redirects to /auth/login if not
 *
 * SSR is disabled because auth checks require browser cookies.
 */

import { queryOptions } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { orpc } from "@/lib/api/orpc-client";
import { getSession } from "@/lib/auth";

const sessionQueryOptions = queryOptions({
	queryKey: ["auth", "session"],
	queryFn: async () => {
		const session = await getSession();
		return session.data ?? null;
	},
	staleTime: 60_000, // 1 minute — avoids re-fetching on every navigation
	retry: 1,
});

export const Route = createFileRoute("/_authenticated")({
	ssr: false,
	beforeLoad: async ({ context, location }) => {
		const result = await context.queryClient.ensureQueryData(
			orpc.setup.getStatus.queryOptions({ input: {} }),
		);

		if (!result.setupComplete) {
			throw redirect({
				to: "/setup",
				search: { redirect: location.href },
			});
		}

		// Setup complete — verify the user has a valid session.
		// Uses TanStack Query cache to avoid re-fetching on every navigation.
		// Actual session lifetime is managed by Better Auth cookies (7 days).
		const session =
			await context.queryClient.ensureQueryData(sessionQueryOptions);
		if (!session) {
			throw redirect({
				to: "/auth/login",
				search: { redirect: location.href },
			});
		}
	},
	component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
	return <Outlet />;
}
