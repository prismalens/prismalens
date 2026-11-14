// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Authenticated Layout Route
 *
 * Pathless layout route that protects all child routes: the browser must be
 * a paired device (`operator.whoami`); the host's own browser pairs through
 * the startup link `pl up` prints (ADR 0004 §8). Anyone else lands on /pair,
 * which explains where a link comes from. There is no account (ADR 0001 §2).
 *
 * SSR is disabled because the check needs the browser's cookies.
 */

import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { PanelShell } from "@/components/shell/PanelShell";
import { TerminalDock } from "@/components/terminal/TerminalDock";
import { useVisitTrail } from "@/hooks/use-back";
import { readOperator } from "@/hooks/use-operator";
import { useLiveChanges } from "@/lib/api/live-refresh";
import {
	lazyPart,
	useAfterFirstContent,
	useOpenedOnce,
	Yielding,
} from "@/lib/lazy";

// What the first frame does not show loads after it (#1101 category 12).
const AttentionRuntime = lazyPart(() =>
	import("@/components/attention/AttentionRuntime").then(
		(m) => m.AttentionRuntime,
	),
);
const RestartNotice = lazyPart(() =>
	import("@/components/shell/RestartNotice").then((m) => m.RestartNotice),
);
const GlobalShortcuts = lazyPart(() =>
	import("@/components/shell/GlobalShortcuts").then((m) => m.GlobalShortcuts),
);
const ShortcutSheet = lazyPart(() =>
	import("@/components/shared/ShortcutSheet").then((m) => m.ShortcutSheet),
);

export const Route = createFileRoute("/_authenticated")({
	ssr: false,
	beforeLoad: async ({ context }) => {
		const whoami = await readOperator(context.queryClient);
		if (!whoami.via) {
			throw redirect({ to: "/pair" });
		}
	},
	component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
	const [helpOpen, setHelpOpen] = useState(false);
	const openHelp = useCallback(() => setHelpOpen(true), []);
	useLiveChanges();
	useVisitTrail();
	const later = useAfterFirstContent();
	const helpMounted = useOpenedOnce(helpOpen);
	return (
		<>
			{later && <RestartNotice />}
			{later && <AttentionRuntime />}
			{later && <GlobalShortcuts onHelp={openHelp} />}
			<PanelShell>
				<Yielding>
					<Outlet />
				</Yielding>
				<TerminalDock />
			</PanelShell>
			{helpMounted && (
				<ShortcutSheet open={helpOpen} onOpenChange={setHelpOpen} />
			)}
		</>
	);
}
