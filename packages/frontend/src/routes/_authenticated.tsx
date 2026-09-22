// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Authenticated Layout Route
 *
 * Pathless layout route that protects all child routes:
 * 1. Checks if initial setup is complete — redirects to /setup if not
 * 2. Verifies the browser is the operator (`operator.whoami`: the host itself
 *    by the loopback rule, or a Better Auth session) — redirects to
 *    /auth/login if not
 *
 * SSR is disabled because auth checks require browser cookies.
 */

import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { ShortcutSheet } from "@/components/shared/ShortcutSheet";
import { useGlobalShortcuts } from "@/hooks/use-global-shortcuts";
import { operatorQueryOptions } from "@/hooks/use-operator";
import { orpc } from "@/lib/api/orpc-client";

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

		// Setup complete — verify the browser is the operator. Cached, so a
		// navigation does not re-ask.
		const whoami = await context.queryClient.fetchQuery(operatorQueryOptions());
		if (!whoami.via) {
			throw redirect({
				to: "/auth/login",
				search: { redirect: location.href },
			});
		}
	},
	component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
	const [helpOpen, setHelpOpen] = useState(false);
	useGlobalShortcuts(useCallback(() => setHelpOpen(true), []));
	return (
		<>
			<Outlet />
			<ShortcutSheet open={helpOpen} onOpenChange={setHelpOpen} />
		</>
	);
}
