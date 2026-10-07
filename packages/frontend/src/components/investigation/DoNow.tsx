// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	InvestigationWithRelations,
	RecommendationPriority,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { InlineCode } from "@/components/shared/InlineCode";
import { StateWord } from "@/components/shared/StateWord";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { recommendationKeys } from "@/lib/api/hooks/use-recommendations-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { formatClock } from "@/lib/format-time";
import { getErrorMessage } from "@/lib/get-error-message";
import { inReportOrder } from "@/lib/report-view";
import { recommendationPriorityTone } from "@/lib/state-tone";
import { cn } from "@/lib/utils";

export type DoNowStep =
	| { kind: "link"; key: string; title: string; serviceId: string }
	| {
			kind: "check";
			key: string;
			id: string;
			title: string;
			detail: string | null;
			priority: RecommendationPriority | null;
			done: boolean;
			doneAt: string | null;
	  };

/**
 * The report's next steps as a shared checklist (decision 6): the run's
 * recommendations in the report's order, and first, when the run read no code,
 * the step PrismaLens itself knows (map the service), as a link, not a box.
 */
export function useDoNow({
	incidentId,
	investigation,
	unmappedService,
}: {
	incidentId: string;
	investigation: InvestigationWithRelations;
	unmappedService: { id: string; name: string } | null;
}): DoNowStep[] {
	const { data: recs = [] } = useQuery(
		orpc.recommendations.list.queryOptions({ input: { incidentId } }),
	);
	const mine = inReportOrder(
		recs.filter((r) => r.investigationId === investigation.id),
		investigation.report?.nextSteps ?? [],
	);
	const steps: DoNowStep[] = mine.map((r) => ({
		kind: "check",
		key: r.id,
		id: r.id,
		title: r.title,
		detail: r.description,
		priority: r.priority,
		done: r.status === "completed",
		doneAt: r.implementedAt,
	}));
	if (unmappedService)
		steps.unshift({
			kind: "link",
			key: "map-service",
			title: `Map ${unmappedService.name} to its repository, then start a new run`,
			serviceId: unmappedService.id,
		});
	return steps;
}

export function DoNow({
	steps,
	className,
}: {
	steps: DoNowStep[];
	className?: string;
}) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const tick = useMutation({
		...orpc.recommendations.update.mutationOptions(),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: recommendationKeys.all() }),
		onError: (err) =>
			toast({
				title: "Step not saved",
				description: getErrorMessage(err),
				variant: "destructive",
			}),
	});
	const done = steps.filter((s) => s.kind === "check" && s.done).length;
	return (
		<section
			id="do-now"
			className={cn("pool mb-3 scroll-mt-4 px-3.5 py-3", className)}
			data-testid="do-now"
		>
			<h3 className="mb-2 flex items-baseline gap-2 text-heading">
				Do now
				<span
					className="font-normal text-text-3 tabular-nums"
					data-testid="do-now-count"
				>
					{done} of {steps.length} done
				</span>
			</h3>
			<p className="mb-1.5 text-meta text-text-2">
				PrismaLens did not run these. Tick what you did; the next person sees
				it.
			</p>
			<ul className="divide-y divide-hairline">
				{steps.map((s) => (
					<li
						key={s.key}
						className="flex items-start gap-2.5 py-2"
						data-testid="do-now-step"
						data-kind={s.kind}
					>
						{s.kind === "link" ? (
							<>
								{/* Done on its own once the service has a repository; nothing to tick. */}
								<span
									aria-hidden
									className="mt-0.5 size-4 shrink-0 rounded-[4px] bg-track"
								/>
								<div className="min-w-0 flex-1 text-body">
									<p>{s.title}</p>
									<Link
										to="/services/$id"
										params={{ id: s.serviceId }}
										className="text-meta text-accent hover:underline"
										data-testid="do-now-service-link"
									>
										Open the service
									</Link>
								</div>
							</>
						) : (
							<>
								<Checkbox
									id={`step-${s.id}`}
									checked={s.done}
									disabled={tick.isPending}
									onCheckedChange={(v) =>
										tick.mutate({
											id: s.id,
											status: v === true ? "completed" : "pending",
										})
									}
									className="mt-0.5"
									data-testid="do-now-check"
								/>
								<label
									htmlFor={`step-${s.id}`}
									className={cn(
										"min-w-0 flex-1 cursor-pointer text-body",
										s.done && "text-text-3",
									)}
								>
									<span className={cn(s.done && "line-through")}>
										<InlineCode text={s.title} />
									</span>
									{s.priority && !s.done && (
										<StateWord
											tone={recommendationPriorityTone(s.priority)}
											className="ml-1.5"
										>
											{s.priority}
										</StateWord>
									)}
									{s.done && s.doneAt ? (
										<span className="block text-meta text-text-3">
											Done by you at {formatClock(s.doneAt)}
										</span>
									) : (
										s.detail && (
											<span className="block text-meta text-text-3">
												<InlineCode text={s.detail} />
											</span>
										)
									)}
								</label>
							</>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}
