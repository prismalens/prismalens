// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { unreadyReason } from "@/components/agent/AgentPicker";
import { IncidentHeader } from "@/components/run/IncidentHeader";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useResumeInvestigation, useServices } from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { resumeFailed } from "@/lib/restart";
import { isBlankIncident } from "./blank";
import { ChangesCard } from "./ChangesCard";
import type { NextActionId } from "./fixes";
import { ImpactCard } from "./ImpactCard";
import { LatestRunStrip } from "./LatestRunStrip";
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
	const blank = isBlankIncident({
		alerts: incident.alerts?.length ?? 0,
		runs: o.record.runs.length,
		changes: o.changes?.total ?? 0,
		deploy: !!o.changes?.deploy,
	});
	const resume = useResumeInvestigation();
	const start = () =>
		void o.record
			.investigate({ ...box.sent, stay: true })
			.catch((error: unknown) =>
				toast({
					title: "The run did not start",
					description: getErrorMessage(error),
					variant: "destructive",
				}),
			);

	const onNext = (id: NextActionId) => {
		const opt = o.current;
		switch (id) {
			case "copy":
				if (opt) void o.copy(opt, commandRef.current);
				return;
			case "applied":
				if (opt) o.apply(opt);
				return;
			case "check":
				if (opt) void o.check(opt);
				return;
			case "next-option":
				o.nextOption();
				return;
			case "resolve":
				o.record.openClose();
				return;
			case "resume":
				// The run a restart cut off, by its own id; Retry would start a new one (#1010).
				if (o.latest)
					resume.mutate({ id: o.latest.id }, { onError: resumeFailed(toast) });
				return;
			case "retry":
			case "investigate":
				// An agent the box can't run says why there instead of failing a start.
				if (!box.harness) return;
				if (unreadyReason(box.harness)) focusBox("investigate");
				else start();
				return;
			case "watch":
				if (o.live)
					void navigate({
						to: "/incidents/$id/conversation",
						params: { id: incident.id },
						search: { investigation: o.live.id },
					});
				return;
		}
	};

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
			<LatestRunStrip o={o} />
			{blank ? (
				<main
					className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-4"
					data-testid="incident-blank"
				>
					<p className="text-heading text-text-2">Nothing yet</p>
					{!incident.service && <LinkService incidentId={incident.id} />}
					<div className="w-full max-w-(--reading-w)">
						<OverviewComposer o={o} action={action} onAction={setAction} />
					</div>
				</main>
			) : (
				<>
					{/* A card row never shrinks below its header and foot; past that the grid scrolls, under 768 px in one column (#673 w5-19). */}
					<main
						className="grid min-h-0 flex-1 auto-rows-[280px] grid-cols-1 grid-rows-[auto] gap-3 overflow-y-auto overscroll-contain px-4 pt-3 pb-1 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:grid-rows-[auto_minmax(120px,1fr)_minmax(120px,1fr)]"
						data-testid="overview-grid"
					>
						<div className="min-w-0 md:col-span-2">
							<SituationCard o={o} onAction={onNext} canStart={!!box.harness} />
						</div>
						<ImpactCard view={o.impact} />
						<StopImpactCard o={o} commandRef={commandRef} />
						<WhyCard o={o} onInvestigate={() => focusBox("investigate")} />
						<ChangesCard o={o} />
					</main>
					<OverviewComposer o={o} action={action} onAction={setAction} />
				</>
			)}
		</div>
	);
}

/** A blank incident's service, picked from the ones PrismaLens knows. */
function LinkService({ incidentId }: { incidentId: string }) {
	const services = useServices();
	const queryClient = useQueryClient();
	const link = useMutation({
		...orpc.incidents.update.mutationOptions(),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: orpc.incidents.key() }),
	});
	const list = services.data?.data ?? [];
	if (list.length === 0) return null;
	return (
		<Select
			disabled={link.isPending}
			onValueChange={(serviceId) => link.mutate({ id: incidentId, serviceId })}
		>
			<SelectTrigger
				aria-label="Link service"
				className="w-56"
				data-testid="incident-link-service"
			>
				<SelectValue placeholder="Link service" />
			</SelectTrigger>
			<SelectContent>
				{list.map((s) => (
					<SelectItem key={s.id} value={s.id}>
						{s.displayName || s.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
