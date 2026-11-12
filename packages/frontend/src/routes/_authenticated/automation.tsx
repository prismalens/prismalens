// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { AlertsBlank } from "@/components/alerts/AlertsBlank";
import { Help } from "@/components/kit";
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
				<div className="flex flex-col gap-6 px-4 pt-3 pb-6">
					<section
						aria-labelledby="auto-schedules"
						className="flex flex-col gap-2"
					>
						<div className="flex items-center gap-1.5">
							<h2 id="auto-schedules" className="text-heading">
								Schedules
							</h2>
							<Help
								about="Schedules"
								text="The agent runs a prompt on a timetable."
							/>
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
						<div className="flex items-center gap-1.5">
							<h2 id="auto-alerts" className="text-heading">
								Alerts and webhooks
							</h2>
							<Help
								about="Alerts and webhooks"
								text="Each alert or event starts a thread."
							/>
							<Link
								to="/alerts"
								data-testid="automation-alerts"
								className="ml-auto inline-flex h-8 items-center px-1 text-body text-accent hover:underline"
							>
								Received alerts
							</Link>
						</div>
						{/* The address and token sit behind one disclosure, received or not (#1101 budget). */}
						<div className="flex flex-col gap-1">
							{last ? (
								<p
									className="flex items-center gap-2 text-body text-text-1"
									data-testid="auto-receiving"
								>
									Last delivery {formatDayClock(last.at, now)}
									<span className="text-text-3 tabular-nums">
										{last.accepted} accepted
									</span>
								</p>
							) : (
								<p
									className="text-body text-text-3"
									data-testid="auto-nothing-yet"
								>
									Nothing received yet
								</p>
							)}
							<details className="text-body text-text-2">
								<summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-control px-1 text-text-2 transition-colors duration-(--dur-instant) hover:text-text-1 [&::-webkit-details-marker]:hidden">
									<ChevronRight
										aria-hidden
										className="size-3.5 transition-transform duration-150 [details[open]_&]:rotate-90"
									/>
									Webhook address
								</summary>
								<AlertsBlank compact />
							</details>
						</div>
					</section>
				</div>
			</div>
		</div>
	);
}
