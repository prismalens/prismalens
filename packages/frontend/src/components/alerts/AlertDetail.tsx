// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	canAlertAction,
	httpUrlOrNull,
	INCIDENT_STATUS_LABEL,
	type IncidentStatus,
	isAlertFiring,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
	alertSince,
	alertWord,
	dayOrClock,
} from "@/components/alerts/AlertListPane";
import { Hint } from "@/components/shared/Hint";
import { Mono } from "@/components/shared/Mono";
import { Loading, Problem } from "@/components/shared/State";
import { StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
	alertBackLabel,
	backTarget,
	inAlertRecord,
	useBack,
} from "@/hooks/use-back";
import { usePageTitle } from "@/hooks/use-page-title";
import { useToast } from "@/hooks/use-toast";
import { alertDotColor } from "@/lib/alert-groups";
import { alertKeys } from "@/lib/api/hooks/use-alerts-orpc";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { formatDateTime } from "@/lib/format-time";
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

/** Key and value rows with a hairline between them, nothing else. */
function KeyValues({ rows }: { rows: [string, ReactNode][] }) {
	return (
		<dl className="divide-y divide-hairline">
			{rows.map(([k, v]) => (
				<div
					key={k}
					className="grid min-h-9 grid-cols-[minmax(6rem,11rem)_minmax(0,1fr)] items-baseline gap-x-6 py-2"
				>
					<dt className="truncate font-mono text-mono leading-5 text-text-3">
						{k}
					</dt>
					<dd className="min-w-0 break-words text-body">{v}</dd>
				</div>
			))}
		</dl>
	);
}

/** "prometheus" reads "Prometheus": a source is a name, not a link (L30). */
function sourceName(source: string | null | undefined): string {
	if (!source) return "Unknown source";
	return source.charAt(0).toUpperCase() + source.slice(1);
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
	const backLabel = alertBackLabel(target, alert?.incident);

	const band = (
		<div
			className="flex h-(--header-h) shrink-0 items-center gap-2.5 bg-surface-1 pr-4 pl-3 desktop:pr-[calc(var(--controls-w)+16px)] desktop:app-drag desktop:[&_a]:app-no-drag desktop:[&_button]:app-no-drag"
			data-testid="alert-band"
		>
			<Hint label={backLabel} keys={["Esc"]}>
				<Button variant="text" size="icon" asChild>
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
						aria-label={`${SEVERITY_LABEL[alert.severity]}, ${isAlertFiring(alert.status) ? "firing" : "cleared"}`}
						className="size-2 shrink-0 rounded-full"
						style={{
							background: alertDotColor(
								alert.severity,
								isAlertFiring(alert.status),
							),
						}}
					/>
					<h1 className="min-w-0 truncate text-title">{alert.title}</h1>
					<span className="flex-1" />
					<StateWord
						tone={alertStatusTone(alert.status)}
						className="max-sm:hidden"
						data-testid="alert-state"
					>
						{alertWord(alert.status)}
					</StateWord>
					<span className="shrink-0 text-meta text-text-3 tabular-nums max-sm:hidden">
						since {dayOrClock(alertSince(alert))}
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
								variant="text"
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
			<div className="flex h-full flex-col" data-testid="alert-detail-loading">
				{band}
				<Loading className="mx-auto w-full max-w-(--reading-w) px-6 pt-4" />
			</div>
		);
	}
	if (error || !alert) {
		return (
			<div className="flex h-full flex-col" data-testid="alert-detail">
				{band}
				<div className="mx-auto w-full max-w-(--reading-w) px-6 pt-4">
					<Problem
						text="Failed to load alert. It may have been deleted."
						back={
							<Button variant="text" size="sm" onClick={back}>
								{backLabel}
							</Button>
						}
					/>
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
							{alertWord(alert.status)}
						</StateWord>
						<span className="text-text-3">
							since {dayOrClock(alertSince(alert))}
						</span>
					</div>
					{alert.description && (
						<p className="mb-8 text-body text-text-2">{alert.description}</p>
					)}

					<Section title="Where it landed">
						{alert.incident ? (
							<div
								className="pool flex min-w-0 items-center gap-3 px-3.5 py-3"
								data-testid="alert-incident"
							>
								<div className="min-w-0 flex-1">
									<Link
										to="/incidents/$id"
										params={{ id: alert.incident.id }}
										className="block truncate text-body text-text-1 hover:underline"
									>
										<Mono className="mr-1.5 text-text-3">
											INC-{alert.incident.number}
										</Mono>
										{alert.incident.title}
									</Link>
									<div className="mt-0.5 truncate text-meta text-text-3">
										{service ?? "No service"}.{" "}
										{INCIDENT_STATUS_LABEL[
											alert.incident.status as IncidentStatus
										] ?? alert.incident.status}
										.
									</div>
								</div>
								<Button variant="text" size="sm" asChild>
									<Link
										to="/incidents/$id"
										params={{ id: alert.incident.id }}
										tabIndex={-1}
										aria-hidden
									>
										Open
									</Link>
								</Button>
							</div>
						) : (
							<div
								className="pool flex flex-wrap items-center justify-between gap-3 px-3.5 py-3"
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
							<div className="flex items-baseline gap-3">
								<span className="text-body text-text-1">
									{sourceName(alert.source)}
								</span>
								{sourceHref && (
									<a
										href={sourceHref}
										target="_blank"
										rel="noreferrer"
										className="text-meta text-text-3 hover:text-text-1"
									>
										Open in the source
									</a>
								)}
							</div>
							<div className="mt-0.5 text-meta text-text-3 tabular-nums">
								{alert.occurrenceCount === 1
									? `Fired once at ${formatDateTime(alert.triggeredAt)}`
									: `${alert.occurrenceCount} occurrences, first ${formatDateTime(alert.triggeredAt)}, last ${formatDateTime(alert.lastOccurrence)}`}
								{alert.status === "resolved" &&
									alert.resolvedAt &&
									`, cleared ${formatDateTime(alert.resolvedAt)}`}
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
														className="text-text-1 hover:underline"
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
								<Button
									variant="text"
									size="sm"
									onClick={() => setPayloadOpen((v) => !v)}
									data-testid="alert-payload-toggle"
								>
									{payloadOpen ? "Hide" : "Show"}
								</Button>
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
