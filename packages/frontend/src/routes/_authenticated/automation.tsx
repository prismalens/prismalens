// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { AlertsBlank } from "@/components/alerts/AlertsBlank";
import {
	NewScheduleAction,
	SchedulesSection,
} from "@/components/schedules/SchedulesSection";
import { PageHeader } from "@/components/shell/PageHeader";
import { usePageTitle } from "@/hooks/use-page-title";
import { useLastDelivery } from "@/lib/api/hooks/use-webhooks-orpc";
import { formatDayClock } from "@/lib/format-time";

export const Route = createFileRoute("/_authenticated/automation")({
	component: Automation,
});

/** What starts threads without you (#1020): schedules, webhooks and alert sources, before any is set up. */
function Automation() {
	usePageTitle("Automation");
	const { data: last } = useLastDelivery();
	const now = Date.now();
	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="automation-page">
			<PageHeader title="Automation" />
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex max-w-[52rem] flex-col gap-8 px-4 py-6">
					<section
						aria-labelledby="auto-schedules"
						className="flex flex-col gap-2"
					>
						<div className="flex items-center gap-3">
							<h2 id="auto-schedules" className="text-heading">
								Schedules
							</h2>
							<span className="text-meta text-text-3">
								The agent runs a prompt on a timetable.
							</span>
							<span className="ml-auto">
								<NewScheduleAction />
							</span>
						</div>
						<SchedulesSection />
					</section>
					<section
						aria-labelledby="auto-alerts"
						className="flex flex-col gap-2"
					>
						<div className="flex items-center gap-3">
							<h2 id="auto-alerts" className="text-heading">
								Alerts and webhooks
							</h2>
							<span className="text-meta text-text-3">
								Each alert or event starts a thread.
							</span>
							<Link
								to="/alerts"
								data-testid="automation-alerts"
								className="ml-auto inline-flex h-8 items-center px-1 text-body text-accent hover:underline"
							>
								Received alerts
							</Link>
						</div>
						{last ? (
							<div className="flex flex-col gap-2">
								<p
									className="text-body text-text-1"
									data-testid="auto-receiving"
								>
									Last delivery {formatDayClock(last.at, now)}, {last.accepted}{" "}
									accepted.
								</p>
								<details className="text-body text-text-2">
									<summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-control bg-surface-2 px-3 text-text-1 transition-colors duration-(--dur-instant) hover:bg-surface-3 [&::-webkit-details-marker]:hidden">
										<ChevronRight
											aria-hidden
											className="size-3.5 transition-transform duration-150 [details[open]_&]:rotate-90"
										/>
										Show the webhook address and token
									</summary>
									<AlertsBlank compact />
								</details>
							</div>
						) : (
							<AlertsBlank compact />
						)}
					</section>
				</div>
			</div>
		</div>
	);
}
