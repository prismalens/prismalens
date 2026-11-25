// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * A run's page, an Ask's, or a new conversation (#811), under its incident.
 * `#step-N` opens a step; `?call=` opens the tool call a report's evidence cites;
 * `?file=` opens the file a citation names, at the run's commit; `?panel=` the
 * right panel's tab (#973).
 */
import { createFileRoute } from "@tanstack/react-router";
import { RunPage } from "@/components/run/RunPage";
import { type PanelTab, panelSearch } from "@/lib/run-panel";
import { prefetchRun } from "@/lib/run-prefetch";

export const Route = createFileRoute(
	"/_authenticated/incidents/$id/conversation",
)({
	validateSearch: (
		search: Record<string, unknown>,
	): { call?: string; file?: string; panel?: PanelTab } => ({
		...(typeof search.call === "string" ? { call: search.call } : {}),
		...panelSearch(search),
	}),
	// The record, the run and its history start beside the page's code, never awaited (#1130).
	loader: ({ params, context, location }) => {
		const run = (location.search as { investigation?: unknown }).investigation;
		void prefetchRun(
			context.queryClient,
			params.id,
			typeof run === "string" && /^[0-9a-f-]{36}$/.test(run) ? run : undefined,
		).catch(() => {});
	},
	component: RunPage,
});
