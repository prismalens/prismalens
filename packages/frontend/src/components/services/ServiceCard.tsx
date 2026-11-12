// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ServiceWithRelations } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ListCard, Mark } from "@/components/kit";
import { codeWhere, kindWord, tierWord } from "./service-detail.utils";

export type Health = "ok" | "degraded" | "down" | "silent";
const HEALTH_WORD: Record<Health, string> = {
	ok: "Nothing open",
	degraded: "Degraded",
	down: "Down",
	silent: "Stopped reporting",
};

/** The worst open severity: critical or high is down, anything else open is degraded. */
export function healthOf(severities: readonly string[]): Health {
	if (severities.some((s) => s === "critical" || s === "high")) return "down";
	return severities.length ? "degraded" : "ok";
}

/**
 * One service as a list card (sheet §6): its health mark, name, then marks
 * for code and open incidents, and its kind, tier and team in words.
 */
export function ServiceCard({
	service,
	open,
	health,
}: {
	service: ServiceWithRelations;
	open: number;
	health: Health;
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
