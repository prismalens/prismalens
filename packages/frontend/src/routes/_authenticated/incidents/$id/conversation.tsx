/**
 * The conversation under an incident (#743 §3c, layer 2): how the agent got
 * there, and the box that messages it while it runs. `?ledger=1` opens the
 * row-per-event view, so a link can land on it.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ConversationRoute } from "@/components/investigation/ConversationRoute";

export const Route = createFileRoute(
	"/_authenticated/incidents/$id/conversation",
)({
	validateSearch: (search: Record<string, unknown>): { ledger?: "1" } =>
		search.ledger === "1" || search.ledger === 1 ? { ledger: "1" } : {},
	component: ConversationRoute,
});
