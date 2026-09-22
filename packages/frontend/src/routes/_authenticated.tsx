// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Authenticated Layout Route
 *
 * Pathless layout route that protects all child routes: the browser must be
 * the operator (`operator.whoami`: the host itself by the loopback rule, or a
 * paired device). Anyone else lands on /pair, which explains where a link
 * comes from. There is no account (ADR 0001 §2).
 *
 * SSR is disabled because the check needs the browser's cookies.
 */

import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { ShortcutSheet } from "@/components/shared/ShortcutSheet";
import { useGlobalShortcuts } from "@/hooks/use-global-shortcuts";
import { operatorQueryOptions } from "@/hooks/use-operator";

export const Route = createFileRoute("/_authenticated")({
	ssr: false,
	beforeLoad: async ({ context }) => {
		// fetchQuery, not ensureQueryData: pairing invalidates this answer and
		// the gate must refetch a stale one rather than hand back the cached null.
		// Within staleTime a navigation still does not re-ask.
		const whoami = await context.queryClient.fetchQuery(operatorQueryOptions());
		if (!whoami.via) {
			throw redirect({ to: "/pair" });
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
