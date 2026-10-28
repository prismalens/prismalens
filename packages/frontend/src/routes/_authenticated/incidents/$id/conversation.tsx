/**
 * A run's page, an Ask's, or a new conversation (#811), under its incident.
 * `#step-N` opens a step; `?call=` opens the tool call a report's evidence cites;
 * `?file=` opens the file a citation names, at the run's commit; `?panel=` the
 * right panel's tab (#973).
 */
import { createFileRoute } from "@tanstack/react-router";
import { RunPage } from "@/components/run/RunPage";
import { type PanelTab, panelTab } from "@/lib/run-panel";

export const Route = createFileRoute(
	"/_authenticated/incidents/$id/conversation",
)({
	validateSearch: (
		search: Record<string, unknown>,
	): { call?: string; file?: string; panel?: PanelTab } => ({
		...(typeof search.call === "string" ? { call: search.call } : {}),
		...(typeof search.file === "string" ? { file: search.file } : {}),
		...(panelTab(search.panel) ? { panel: panelTab(search.panel) } : {}),
	}),
	component: RunPage,
});
