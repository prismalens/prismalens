// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isRunStateLive } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { Square } from "lucide-react";
import { RunDot } from "@/components/incidents/RunTree";
import {
	runElapsed,
	runTimed,
	useRunAgentModel,
} from "@/components/incidents/run-facts";
import { RunsMenu } from "@/components/run/RunsMenu";
import { refRunState, runOutcome, viewName } from "@/components/run/run-labels";
import { Button } from "@/components/ui/button";
import { ago, useNow } from "@/hooks/use-now";
import { failureWords } from "@/lib/failure-words";
import { formatElapsed } from "@/lib/format-time";
import { cn } from "@/lib/utils";
import type { Overview } from "./use-overview";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The strip under the header (#811): the latest run, its state and what it
 * came to, the agent and model (ruling 4: no credential here), Stop run
 * while live, and the runs menu. The run name opens its transcript.
 */
export function LatestRunStrip({ o }: { o: Overview }) {
	const now = useNow(1000);
	const { incident, runs } = o.record;
	const latest = o.latest;
	const run = o.latestRun;
	const inv = run.investigation;
	const who = useRunAgentModel(inv);
	const state = latest ? (run.state ?? refRunState(latest)) : null;
	const live = !!state && isRunStateLive(state);
	const name = latest ? viewName(runs, latest) : null;
	const took =
		inv && runTimed(inv) ? formatElapsed(runElapsed(inv, now)) : null;
	const outcome = latest ? runOutcome(latest) : "";
	const detail = !latest
		? "No run yet"
		: live
			? (run.latestText ?? "Working")
			: state === "failed"
				? failureWords(inv?.error ?? latest.error).what
				: latest.hasReport
					? latest.rootCause
						? "Likely cause found"
						: "No cause named"
					: cap(outcome);
	const when = latest
		? live
			? `started ${ago(latest.startedAt ?? latest.createdAt, now)}`
			: [
					ago(latest.completedAt ?? latest.createdAt, now),
					took && `${state === "failed" ? "after" : "took"} ${took}`,
				]
					.filter(Boolean)
					.join(", ")
		: "";
	return (
		<div
			className="relative flex h-9 min-w-0 shrink-0 items-center gap-3 px-4 whitespace-nowrap after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-hairline"
			data-testid="latest-run-strip"
		>
			<span className="shrink-0 text-text-3">Latest run</span>
			{state ? (
				<RunDot state={state} className="size-[7px]" />
			) : (
				<span
					aria-hidden
					className="size-[7px] shrink-0 rounded-full bg-text-3"
				/>
			)}
			{latest && name ? (
				<Link
					to="/incidents/$id/conversation"
					params={{ id: incident.id }}
					search={{ investigation: latest.id }}
					className="shrink-0 font-medium hover:underline"
					data-testid="latest-run-link"
				>
					{name}{" "}
					{live
						? "investigating"
						: state === "failed"
							? "failed"
							: state === "stopped"
								? "stopped"
								: "concluded"}
				</Link>
			) : null}
			<span
				className={cn(
					"min-w-[100px] shrink truncate",
					live
						? "text-live"
						: state === "failed"
							? "text-danger"
							: "text-text-2",
				)}
				data-testid="latest-run-detail"
			>
				{detail}
			</span>
			<span className="shrink-0 text-text-3 max-lg:hidden">{when}</span>
			<span className="flex-1" />
			{latest && (
				<span
					className="shrink-0 text-text-3 max-xl:hidden"
					data-testid="latest-run-agent"
				>
					{who.agent}, {cap(who.model)}
				</span>
			)}
			{live && (
				<Button
					variant="secondary"
					className="h-[26px] shrink-0 gap-1.5 bg-surface-2 hover:bg-surface-3"
					disabled={run.stopRequested}
					onClick={() => run.stop({ onError: () => undefined })}
					data-testid="latest-run-stop"
				>
					<Square className="size-3 fill-current" aria-hidden />
					{run.stopRequested ? "Stopping" : "Stop run"}
				</Button>
			)}
			<RunsMenu incidentId={incident.id} runs={runs} current={null} />
		</div>
	);
}
