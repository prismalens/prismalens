// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { unreadyReason } from "@/components/agent/AgentPicker";
import { IncidentHeader } from "@/components/run/IncidentHeader";
import { useToast } from "@/hooks/use-toast";
import { useResumeInvestigation } from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { resumeFailed } from "@/lib/restart";
import { triggerOf } from "@/lib/trigger";
import { isBlankIncident } from "./blank";
import { ChangesCard } from "./ChangesCard";
import { ImpactCard } from "./ImpactCard";
import { LatestRunStrip } from "./LatestRunStrip";
import { LinkService } from "./LinkService";
import { nextHandler } from "./next-action";
import {
	type OverviewAction,
	OverviewComposer,
	useBoxChoice,
} from "./OverviewComposer";
import { SituationCard } from "./SituationCard";
import { StopImpactCard } from "./StopImpactCard";
import { useOverview } from "./use-overview";
import { WhyCard } from "./WhyCard";

/**
 * The incident overview (#811 spec screen 2): one page, no tabs. The window
 * never scrolls (ADR 0008 §2): the Situation row takes what it needs, two
 * rows of fixed cards split the rest, and each card scrolls inside itself.
 */
export function OverviewPage() {
	const o = useOverview();
	const { incident } = o.record;
	const navigate = useNavigate();
	const { toast } = useToast();
	const commandRef = useRef<HTMLElement>(null);
	const [action, setAction] = useState<OverviewAction | null>(null);

	const focusBox = (a: OverviewAction) => {
		setAction(a);
		window.setTimeout(
			() =>
				document
					.querySelector<HTMLTextAreaElement>(
						"[data-testid=overview-composer] textarea",
					)
					?.focus(),
			0,
		);
	};
	const box = useBoxChoice(o.record);
	// Cards are earned: no alert, run, note or change means nothing to put in one.
	const blank = isBlankIncident({
		alerts: incident.alerts?.length ?? 0,
		runs: o.record.runs.length,
		changes: o.changes?.total ?? 0,
		deploy: !!o.changes?.deploy,
		entries: (o.record.timeline ?? []).filter(
			(e) => e.type !== "incident_created",
		).length,
	});
	const resume = useResumeInvestigation();
	const start = () =>
		void o.record.investigate({ ...box.sent }).catch((error: unknown) =>
			toast({
				title: "The run did not start",
				description: getErrorMessage(error),
				variant: "destructive",
			}),
		);

	const onNext = nextHandler(o, {
		commandRef,
		// The run a restart cut off, by its own id; Retry would start a new one (#1010).
		resume: () => {
			if (o.latest)
				resume.mutate({ id: o.latest.id }, { onError: resumeFailed(toast) });
		},
		investigate: () => {
			// An agent the box can't run says why there instead of failing a start.
			if (!box.harness) return;
			if (unreadyReason(box.harness)) focusBox("investigate");
			else start();
		},
		ask: () => focusBox("ask"),
		services: () => void navigate({ to: "/services", search: { add: "1" } }),
		watch: () => {
			if (o.live)
				void navigate({
					to: "/incidents/$id/conversation",
					params: { id: incident.id },
					search: { investigation: o.live.id },
				});
		},
	});

	const event = triggerOf(incident).kind === "webhook";
	return (
		<div
			className="flex h-full min-h-0 flex-col"
			data-testid="incident-overview"
		>
			<IncidentHeader
				incident={incident}
				view="Overview"
				reportRunId={o.reported?.id ?? null}
				onResolve={o.record.openClose}
				onReopen={o.record.openReopen}
				onEditCause={o.record.openEditCause}
			/>
			{blank ? (
				<main
					className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto pb-[12vh]"
					data-testid="incident-blank"
				>
					<h2 className="mb-4 text-center text-display text-text-1">
						What do you know so far?
					</h2>
					{!incident.service && (
						<div className="mb-4 flex justify-center">
							<LinkService incidentId={incident.id} />
						</div>
					)}
					<OverviewComposer o={o} action={action} onAction={setAction} />
				</main>
			) : (
				<>
					<LatestRunStrip o={o} />
					{/* A card row never shrinks below its header and foot; past that the grid scrolls, under 768 px in one column (#673 w5-19). */}
					<main
						className="grid min-h-0 flex-1 auto-rows-[280px] grid-cols-1 grid-rows-[auto] gap-3 overflow-y-auto overscroll-contain px-4 pt-3 pb-1 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:grid-rows-[auto_minmax(120px,1fr)_minmax(120px,1fr)]"
						data-testid="overview-grid"
					>
						<div className="min-w-0 md:col-span-2">
							<SituationCard o={o} onAction={onNext} canStart={!!box.harness} />
						</div>
						{/* A webhook event has no impact to measure, only what changed around it. */}
						{!event && <ImpactCard view={o.impact} />}
						{/* Before any run, Why and Stop the impact only repeat "no run yet" (#1020). */}
						{o.latest && <StopImpactCard o={o} commandRef={commandRef} />}
						{o.latest && (
							<WhyCard o={o} onInvestigate={() => focusBox("investigate")} />
						)}
						<ChangesCard o={o} wide={event && !o.latest} />
					</main>
					<OverviewComposer o={o} action={action} onAction={setAction} />
				</>
			)}
		</div>
	);
}
