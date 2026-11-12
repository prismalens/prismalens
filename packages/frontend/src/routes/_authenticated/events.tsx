// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createFileRoute } from "@tanstack/react-router";
import { EventListPanel } from "@/components/attention/EventList";
import { PageHeader } from "@/components/shell/PageHeader";
import { usePageTitle } from "@/hooks/use-page-title";

export const Route = createFileRoute("/_authenticated/events")({
	component: Events,
});

/** What happened to threads while you looked elsewhere: a page, not a sheet (#1101). */
function Events() {
	usePageTitle("Events");
	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="events-page">
			<PageHeader title="Events" />
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex max-w-[52rem] flex-col px-4 py-4">
					<EventListPanel />
				</div>
			</div>
		</div>
	);
}
