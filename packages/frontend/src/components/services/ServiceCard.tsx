// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ServiceWithRelations } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ListCard, Mark } from "@/components/kit";
import { ago } from "@/hooks/use-now";
import { codeWhere, kindWord, tierWord } from "./service-detail.utils";

export type Health = "ok" | "degraded" | "down" | "silent";
const HEALTH_WORD: Record<Health, string> = {
	ok: "Nothing open",
	degraded: "Degraded",
	down: "Down",
	silent: "Stopped reporting",
};

/** Quiet this long after a report, a service is silent. No shared staleness threshold exists to reuse. */
export const SILENT_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * The worst open severity: critical or high is down, anything else open is
 * degraded. With nothing open, a service whose last report is older than
 * `SILENT_AFTER_MS` is silent; one that never reported is ok.
 */
export function healthOf(
	severities: readonly string[],
	lastReportAt?: string | null,
	now?: number | null,
): Health {
	if (severities.some((s) => s === "critical" || s === "high")) return "down";
	if (severities.length) return "degraded";
	if (lastReportAt && now != null) {
		const quiet = now - Date.parse(lastReportAt);
		if (quiet > SILENT_AFTER_MS) return "silent";
	}
	return "ok";
}

/**
 * One service as a list card (sheet §6): its health mark, name, then marks
 * for code and open incidents, and its kind, tier and team in words.
 */
export function ServiceCard({
	service,
	open,
	health,
	now = null,
}: {
	service: ServiceWithRelations;
	open: number;
	health: Health;
	/** For the silent mark's hint: when the service last reported. */
	now?: number | null;
}) {
	const code = codeWhere(service);
	return (
		<ListCard
			testId="service-row"
			title={service.name}
			icon={
				<Mark
					id="health"
					state={health}
					word={HEALTH_WORD[health]}
					meta={
						health === "silent" && service.lastReportAt && now != null
							? `Last report ${ago(service.lastReportAt, now)}`
							: undefined
					}
					testId="service-health"
				/>
			}
			link={(title) => (
				<Link
					to="/services/$id"
					params={{ id: service.id }}
					data-testid="service-row-link"
				>
					{title}
				</Link>
			)}
			meta={
				<span
					className="flex min-w-0 items-center gap-2.5"
					data-testid="service-line"
				>
					<Mark
						id="code"
						state={code ? "linked" : "missing"}
						word={code ?? "No code linked"}
						testId="service-code"
					/>
					<Mark
						id="alert"
						state={open ? "triggered" : "resolved"}
						word={open ? `${open} open` : "None open"}
						className="text-text-2"
						testId="service-open"
					>
						{open > 0 && open}
					</Mark>
					<span className="min-w-0 truncate text-text-3">
						{[kindWord(service.type), tierWord(service.tier), service.team]
							.filter(Boolean)
							.join(" · ")}
					</span>
				</span>
			}
		/>
	);
}
