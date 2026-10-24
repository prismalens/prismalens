/**
 * A run's page, an Ask's, or a new conversation (#811), under its incident.
 * `#step-N` opens a step; `?call=` opens the tool call a report's evidence cites;
 * `?file=` opens the file a citation names, at the run's commit.
 */
import { createFileRoute } from "@tanstack/react-router";
import { RunPage } from "@/components/run/RunPage";

export const Route = createFileRoute(
	"/_authenticated/incidents/$id/conversation",
)({
	validateSearch: (
		search: Record<string, unknown>,
	): { call?: string; file?: string } => ({
		...(typeof search.call === "string" ? { call: search.call } : {}),
		...(typeof search.file === "string" ? { file: search.file } : {}),
	}),
	component: RunPage,
});
