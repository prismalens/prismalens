// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ALERT_STATUS_LABEL,
	canAlertAction,
	httpUrlOrNull,
	INCIDENT_STATUS_LABEL,
	type IncidentStatus,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Hint } from "@/components/shared/Hint";
import { Mono } from "@/components/shared/Mono";
import { StateWord } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { backTarget, inAlertRecord, useBack } from "@/hooks/use-back";
import { usePageTitle } from "@/hooks/use-page-title";
import { useToast } from "@/hooks/use-toast";
import { alertKeys } from "@/lib/api/hooks/use-alerts-orpc";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { formatClock, formatDateTime } from "@/lib/format-time";
import { getErrorMessage } from "@/lib/get-error-message";
import { alertStatusTone } from "@/lib/state-tone";

function prettyPayload(raw: string | null): string | null {
	if (!raw) return null;
	try {
		return JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		return raw;
	}
}

function Section({
	id,
	title,
	count,
	action,
	children,
}: {
	id?: string;
	title: string;
	count?: number;
	action?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<section id={id} className="mt-8 first:mt-0">
			<h2 className="mb-2 flex items-baseline gap-2 text-heading">
				{title}
				{count !== undefined && (
					<span className="font-normal text-text-3 tabular-nums">{count}</span>
				)}
				{action && <span className="ml-auto font-normal">{action}</span>}
			</h2>
			{children}
		</section>
	);
}

function KeyValues({ rows }: { rows: [string, ReactNode][] }) {
	return (
		<dl className="grid grid-cols-[minmax(6rem,11rem)_minmax(0,1fr)] gap-x-6 gap-y-1.5">
			{rows.map(([k, v]) => (
				<div key={k} className="contents">
					<dt className="truncate font-mono text-mono leading-5 text-text-3">
						{k}
					</dt>
					<dd className="min-w-0 break-words text-body">{v}</dd>
				</div>
			))}
		</dl>
	);
}

/**
 * One alert (study-v3 §8, mock `alerts`): a band with Back to where you came
 * from, the alert's state and its incident; no Acknowledge of its own, since
 * acknowledging is the incident's.
 */
export function AlertDetail({ alertId }: { alertId: string }) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const {
		data: alert,
		isLoading,
		error,
	} = useQuery(orpc.alerts.get.queryOptions({ input: { id: alertId } }));
	usePageTitle(alert?.title ?? "Alert");
	const back = useBack(inAlertRecord, "/alerts");
	useEscapeBack(back);

	const invalidate = () => {
		queryClient.invalidateQueries({ queryKey: alertKeys.all() });
		queryClient.invalidateQueries({ queryKey: incidentKeys.all() });
	};
	const fail = (title: string) => (err: unknown) =>
		toast({ title, description: getErrorMessage(err), variant: "destructive" });
	const resolve = useMutation({
		...orpc.alerts.resolve.mutationOptions(),
		onSuccess: invalidate,
		onError: fail("Could not resolve"),
	});
	const correlate = useMutation({
		...orpc.alerts.correlate.mutationOptions(),
		onSuccess: () => {
			invalidate();
			toast({
				title: "Correlated",
				description: "The alert went through the rules again.",
			});
		},
		onError: fail("Still suppressed"),
	});

	const [payloadOpen, setPayloadOpen] = useState(false);
	const payload = useMemo(
		() => prettyPayload(alert?.rawPayload ?? null),
		[alert?.rawPayload],
	);

	const target = backTarget(inAlertRecord, "/alerts");
	const backLabel = (() => {
		if (alert?.incident && target.startsWith(`/incidents/${alert.incident.id}`))
			return `Back to INC-${alert.incident.number}`;
		if (target.startsWith("/incidents")) return "Back to the incident";
		if (target.startsWith("/alerts")) return "Back to alerts";
		return "Back";
	})();

	const band = (
		<div
			className="flex h-(--header-h) shrink-0 items-center gap-2.5 bg-canvas pr-4 pl-3 desktop:app-drag desktop:[&_a]:app-no-drag desktop:[&_button]:app-no-drag"
			data-testid="alert-band"
		>
			<Hint label={backLabel} keys={["Esc"]}>
				<Button variant="ghost" size="icon" asChild>
					<a
						href={target}
						onClick={(e) => {
							e.preventDefault();
							back();
						}}
						aria-label={backLabel}
						data-testid="alert-back"
					>
						<ChevronLeft className="size-4" />
					</a>
				</Button>
			</Hint>
			{alert && (
				<>
					<span
						role="img"
						aria-label={SEVERITY_LABEL[alert.severity]}
						className="size-2 shrink-0 rounded-full"
						style={{ background: `var(--sev-${alert.severity})` }}
					/>
					<h1 className="min-w-0 truncate text-title" title={alert.title}>
						{alert.title}
					</h1>
					<span className="flex-1" />
					<StateWord
						tone={alertStatusTone(alert.status)}
						className="max-sm:hidden"
						data-testid="alert-state"
					>
						{ALERT_STATUS_LABEL[alert.status]}
					</StateWord>
					<span className="shrink-0 text-meta text-text-3 tabular-nums max-sm:hidden">
						since {formatClock(alert.triggeredAt)}
					</span>
					{alert.incident && (
						<Button variant="secondary" asChild>
							<Link
								to="/incidents/$id"
								params={{ id: alert.incident.id }}
								data-testid="alert-open-incident"
							>
								Open INC-{alert.incident.number}
							</Link>
						</Button>
					)}
					<DropdownMenu modal={false}>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								aria-label="More actions"
								data-testid="alert-more"
							>
								<MoreHorizontal className="size-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{canAlertAction("resolve", alert.status) && (
								<DropdownMenuItem
									onSelect={() => resolve.mutate({ id: alert.id })}
									disabled={resolve.isPending}
									data-testid="alert-resolve"
								>
									Resolve this alert
								</DropdownMenuItem>
							)}
							{payload && (
								<DropdownMenuItem
									onSelect={() => {
										navigator.clipboard?.writeText(payload);
										toast({ title: "Payload copied" });
									}}
								>
									Copy the raw payload
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</>
			)}
		</div>
	);

	if (isLoading) {
		return (
			<div className="flex h-full flex-col" data-testid="alert-detail">
				{band}
				<div className="mx-auto w-full max-w-(--reading-w) space-y-3 px-6 pt-4">
					<Skeleton className="h-3 w-1/3" />
					<Skeleton className="h-3 w-2/3" />
					<Skeleton className="h-3 w-1/2" />
				</div>
			</div>
		);
	}
	if (error || !alert) {
		return (
			<div className="flex h-full flex-col" data-testid="alert-detail">
				{band}
				<div className="mx-auto w-full max-w-(--reading-w) px-6 pt-4">
					<p className="text-body text-text-1">Failed to load alert</p>
					<p className="text-meta text-text-3">
						{error?.message || "Alert not found"}
					</p>
				</div>
			</div>
		);
	}

	const labels = Object.entries(alert.labels ?? {});
	const sourceHref = httpUrlOrNull(alert.sourceUrl);
	const service = alert.service
		? alert.service.displayName || alert.service.name
		: null;

	return (
		<div
			className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]"
			data-testid="alert-detail"
		>
			{band}
			<div className="min-h-0 overflow-y-auto">
				<div className="mx-auto w-full max-w-(--reading-w) px-4 pt-4 pb-12 md:px-6">
					<div className="mb-6 flex items-center gap-2.5 text-meta sm:hidden">
						<StateWord tone={alertStatusTone(alert.status)}>
							{ALERT_STATUS_LABEL[alert.status]}
						</StateWord>
						<span className="text-text-3">
							since {formatClock(alert.triggeredAt)}
						</span>
					</div>
					{alert.description && (
						<p className="mb-8 text-body text-text-2">{alert.description}</p>
					)}

					<Section title="Where it landed">
						{alert.incident ? (
							<div className="py-1" data-testid="alert-incident">
								<Link
									to="/incidents/$id"
									params={{ id: alert.incident.id }}
									className="text-body text-text-1 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
								>
									<Mono className="mr-1.5 text-text-3">
										INC-{alert.incident.number}
									</Mono>
									{alert.incident.title}
								</Link>
								<div className="mt-0.5 flex gap-2.5 text-meta">
									{service && <span className="text-text-2">{service}</span>}
									<span className="text-text-3">
										{INCIDENT_STATUS_LABEL[
											alert.incident.status as IncidentStatus
										] ?? alert.incident.status}
									</span>
								</div>
							</div>
						) : (
							<div
								className="flex flex-wrap items-start justify-between gap-3 py-1"
								data-testid={
									alert.suppressedBy ? "alert-suppressed" : "alert-uncorrelated"
								}
							>
								<p className="min-w-0 flex-1 text-body text-text-2">
									{alert.suppressedBy ? (
										<>
											Held down by the rule{" "}
											<Mono className="text-text-1">
												{alert.suppressedBy.ruleName}
											</Mono>
											. It reaches no incident while that rule is on.
										</>
									) : (
										"No incident. No rule matched it, or it fired before its service existed."
									)}
								</p>
								<Button
									variant="secondary"
									size="sm"
									onClick={() => correlate.mutate({ id: alert.id })}
									disabled={correlate.isPending}
									data-testid="alert-correlate"
								>
									{alert.suppressedBy ? "Correlate anyway" : "Run correlation"}
								</Button>
							</div>
						)}
					</Section>

					<Section id="identity" title="Source">
						<div className="py-1">
							{sourceHref ? (
								<a
									href={sourceHref}
									target="_blank"
									rel="noreferrer"
									className="text-body text-accent hover:underline"
								>
									{alert.source ?? sourceHref}
								</a>
							) : (
								<span className="text-body">
									{alert.source ?? "Unknown source"}
								</span>
							)}
							<div className="mt-0.5 text-meta text-text-3 tabular-nums">
								{alert.occurrenceCount === 1
									? `Fired once at ${formatDateTime(alert.triggeredAt)}`
									: `${alert.occurrenceCount} occurrences, first ${formatDateTime(alert.triggeredAt)}, last ${formatDateTime(alert.lastOccurrence)}`}
							</div>
						</div>
						<div className="mt-3">
							<KeyValues
								rows={[
									["dedup key", <Mono key="d">{alert.dedupKey}</Mono>],
									...(alert.fingerprint
										? ([
												[
													"fingerprint",
													<Mono key="f">{alert.fingerprint}</Mono>,
												],
											] as [string, ReactNode][])
										: []),
									...(alert.externalId
										? ([
												[
													"external id",
													<Mono key="e">{alert.externalId}</Mono>,
												],
											] as [string, ReactNode][])
										: []),
									...(service && alert.service
										? ([
												[
													"service",
													<Link
														key="s"
														to="/services/$id"
														params={{ id: alert.service.id }}
														search={{ tab: "overview" }}
														className="text-accent hover:underline"
													>
														{service}
													</Link>,
												],
											] as [string, ReactNode][])
										: []),
								]}
							/>
						</div>
					</Section>

					{(labels.length > 0 || (alert.tags?.length ?? 0) > 0) && (
						<Section title="Labels" count={labels.length}>
							<KeyValues
								rows={[
									...labels.map(([k, v]) => [k, v] as [string, ReactNode]),
									...(alert.tags?.length
										? ([["tags", alert.tags.join(", ")]] as [
												string,
												ReactNode,
											][])
										: []),
								]}
							/>
						</Section>
					)}

					<Section
						title="Raw payload"
						action={
							payload ? (
								<button
									type="button"
									className="text-meta text-text-3 outline-none hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent"
									onClick={() => setPayloadOpen((v) => !v)}
									data-testid="alert-payload-toggle"
								>
									{payloadOpen ? "Hide" : "Show"}
								</button>
							) : undefined
						}
					>
						{!payload && (
							<p className="text-body text-text-2">
								The source sent nothing beyond the fields above.
							</p>
						)}
						{payload && payloadOpen && (
							<pre
								className="raised overflow-auto rounded-surface p-3 font-mono text-mono text-text-2"
								data-testid="alert-payload"
							>
								{payload}
							</pre>
						)}
					</Section>
				</div>
			</div>
		</div>
	);
}

/** Esc is the chevron on a record (study-v2 §5.1), unless a field or a dialog has it. */
function useEscapeBack(back: () => void) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented) return;
			const t = e.target as HTMLElement | null;
			if (
				t?.tagName === "INPUT" ||
				t?.tagName === "TEXTAREA" ||
				t?.tagName === "SELECT" ||
				t?.isContentEditable
			)
				return;
			if (
				document.querySelector(
					"[role=dialog], [role=alertdialog], [role=menu], [data-radix-popper-content-wrapper]",
				)
			)
				return;
			back();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [back]);
}
