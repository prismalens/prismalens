/**
 * The incident overview (#811): one page, no tabs.
 */
import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "@/components/overview/OverviewPage";

export const Route = createFileRoute("/_authenticated/incidents/$id/")({
	component: OverviewPage,
});
