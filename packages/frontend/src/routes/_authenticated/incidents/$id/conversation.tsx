/**
 * The conversation under an incident (#743 §3c, layer 2): how the agent got
 * there, and the box that messages it while it runs.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ConversationRoute } from "@/components/investigation/ConversationRoute";

export const Route = createFileRoute(
	"/_authenticated/incidents/$id/conversation",
)({
	component: ConversationRoute,
});
