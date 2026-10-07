/**
 * The conversation under an incident (#673): the selected run's transcript
 * and the box. `?call=` opens the tool call a report's evidence cites.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ConversationRoute } from "@/components/investigation/ConversationRoute";

export const Route = createFileRoute(
	"/_authenticated/incidents/$id/conversation",
)({
	validateSearch: (search: Record<string, unknown>): { call?: string } => ({
		...(typeof search.call === "string" ? { call: search.call } : {}),
	}),
	component: ConversationRoute,
});
