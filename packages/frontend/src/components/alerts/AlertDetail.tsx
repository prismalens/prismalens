// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ALERT_STATUS_LABEL,
	canAlertAction,
	httpUrlOrNull,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Copy, ExternalLink, Link2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Mono } from "@/components/shared/Mono";
import { RecordSection } from "@/components/shared/RecordSection";
import { StateChip, StateWord } from "@/components/shared/StateChip";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ago, useNow } from "@/hooks/use-now";
import { usePageTitle } from "@/hooks/use-page-title";
import { useToast } from "@/hooks/use-toast";
import { alertKeys } from "@/lib/api/hooks/use-alerts-orpc";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { formatDateTime } from "@/lib/format-time";
import { getErrorMessage } from "@/lib/get-error-message";
import { alertStatusTone } from "@/lib/state-tone";

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			<dt className="text-meta text-muted-foreground">{label}</dt>
			<dd className="truncate text-record">{children}</dd>
		</div>
	);
}

function prettyPayload(raw: string | null): string | null {
	if (!raw) return null;
	try {
		return JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		return raw;
	}
}

export function AlertDetail({ alertId }: { alertId: string }) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const now = useNow();
	const {
		data: alert,
		isLoading,
		error,
	} = useQuery(orpc.alerts.get.queryOptions({ input: { id: alertId } }));
	usePageTitle(alert?.title ?? "Alert");

	const invalidate = () => {
		queryClient.invalidateQueries({ queryKey: alertKeys.all() });
		queryClient.invalidateQueries({ queryKey: incidentKeys.all() });
	};
	const fail = (title: string) => (err: unknown) =>
		toast({ title, description: getErrorMessage(err), variant: "destructive" });
	const acknowledge = useMutation({
		...orpc.alerts.acknowledge.mutationOptions(),
		onSuccess: invalidate,
		onError: fail("Could not acknowledge"),
	});
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
				description: "The alert was run through the waterfall again.",
			});
		},
		onError: fail("Still suppressed"),
	});

	const [payloadOpen, setPayloadOpen] = useState(false);
	const payload = useMemo(
		() => prettyPayload(alert?.rawPayload ?? null),
		[alert?.rawPayload],
	);

	if (isLoading) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-8 w-2/3" />
				<Skeleton className="h-40" />
			</div>
		);
	}
	if (error || !alert) {
		return (
			<div className="flex flex-col items-center py-12">
				<p className="text-record font-medium text-run-failed">
					Failed to load alert
				</p>
				<p className="text-meta text-muted-foreground">
					{error?.message || "Alert not found"}
				</p>
			</div>
		);
	}

	const labels = Object.entries(alert.labels ?? {});
	const sourceHref = httpUrlOrNull(alert.sourceUrl);

	return (
		<div
			className="grid h-full grid-rows-[auto_minmax(0,1fr)]"
			data-testid="alert-detail"
		>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-background px-3 py-1.5 sm:h-10 sm:flex-nowrap sm:overflow-hidden sm:py-0">
				<Link
					to="/alerts"
					aria-label="Back to alerts"
					className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
				>
					<ChevronLeft className="h-4 w-4" />
				</Link>
				<span
					role="img"
					aria-label={SEVERITY_LABEL[alert.severity]}
					title={SEVERITY_LABEL[alert.severity]}
					className="h-2 w-2 shrink-0 rounded-full"
					style={{ background: `var(--sev-${alert.severity})` }}
				/>
				<h1
					className="order-last line-clamp-2 min-w-0 basis-full text-record font-semibold tracking-tight sm:order-none sm:line-clamp-none sm:flex-1 sm:basis-auto sm:truncate"
					title={alert.title}
				>
					{alert.title}
				</h1>
				<StateWord tone={alertStatusTone(alert.status)} className="shrink-0">
					{ALERT_STATUS_LABEL[alert.status]}
				</StateWord>
				{alert.occurrenceCount > 1 && (
					<span className="shrink-0 text-meta text-muted-foreground tabular-nums">
						×{alert.occurrenceCount}
					</span>
				)}
				<span className="hidden shrink-0 text-meta text-muted-foreground tabular-nums sm:inline">
					{ago(alert.triggeredAt, now)}
				</span>
				<div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-1">
					{canAlertAction("acknowledge", alert.status) && (
						<Button
							variant="outline"
							size="sm"
							className="h-7"
							onClick={() => acknowledge.mutate({ id: alert.id })}
							disabled={acknowledge.isPending}
							data-testid="alert-acknowledge"
						>
							Acknowledge
						</Button>
					)}
					{canAlertAction("resolve", alert.status) && (
						<Button
							size="sm"
							className="h-7"
							onClick={() => resolve.mutate({ id: alert.id })}
							disabled={resolve.isPending}
							data-testid="alert-resolve"
						>
							Resolve
						</Button>
					)}
				</div>
			</div>

			<div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6">
				<div className="max-w-4xl space-y-6">
					{alert.description && (
						<p className="text-record text-muted-foreground">
							{alert.description}
						</p>
					)}

					<RecordSection id="where" title="Where it landed">
						{alert.incident ? (
							<div
								className="flex flex-wrap items-center gap-2 rounded-md border p-3"
								data-testid="alert-incident"
							>
								<Link2 className="h-4 w-4 text-muted-foreground" />
								<Link
									to="/incidents/$id"
									params={{ id: alert.incident.id }}
									className="text-record font-medium hover:underline"
								>
									<Mono className="mr-1 text-muted-foreground">
										INC-{alert.incident.number}
									</Mono>
									{alert.incident.title}
								</Link>
								<StatusBadge
									status={alert.incident.status as never}
									kind="incident"
								/>
							</div>
						) : alert.suppressedBy ? (
							<div
								className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-stale/50 bg-stale/8 p-3"
								data-testid="alert-suppressed"
							>
								<div className="text-record">
									<StateChip tone="stale" className="mr-2">
										suppressed
									</StateChip>
									Held down by the rule{" "}
									<Mono className="font-medium">
										{alert.suppressedBy.ruleName}
									</Mono>
									. It will not reach an incident while that rule is enabled.
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={() => correlate.mutate({ id: alert.id })}
									disabled={correlate.isPending}
									data-testid="alert-correlate"
								>
									Correlate anyway
								</Button>
							</div>
						) : (
							<div
								className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-3"
								data-testid="alert-uncorrelated"
							>
								<p className="text-record text-muted-foreground">
									No incident. Nothing in the waterfall matched it, or it fired
									before its service existed.
								</p>
								<Button
									variant="outline"
									size="sm"
									onClick={() => correlate.mutate({ id: alert.id })}
									disabled={correlate.isPending}
									data-testid="alert-correlate"
								>
									Run correlation
								</Button>
							</div>
						)}
					</RecordSection>

					<RecordSection id="identity" title="Identity">
						<dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
							<Field label="Source">
								{sourceHref ? (
									<a
										href={sourceHref}
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
									>
										{alert.source ?? sourceHref}
										<ExternalLink className="h-3 w-3" />
									</a>
								) : (
									<Mono>{alert.source ?? "—"}</Mono>
								)}
							</Field>
							<Field label="Service">
								{alert.service ? (
									<Link
										to="/services/$id"
										params={{ id: alert.service.id }}
										search={{ tab: "overview" }}
										className="text-primary hover:underline"
									>
										{alert.service.displayName || alert.service.name}
									</Link>
								) : (
									"—"
								)}
							</Field>
							<Field label="Dedup key">
								<Mono title={alert.dedupKey}>{alert.dedupKey}</Mono>
							</Field>
							<Field label="Fingerprint">
								<Mono title={alert.fingerprint ?? undefined}>
									{alert.fingerprint ?? "—"}
								</Mono>
							</Field>
							<Field label="External id">
								<Mono>{alert.externalId ?? "—"}</Mono>
							</Field>
							<Field label="Occurrences">
								<span className="tabular-nums">{alert.occurrenceCount}</span>
							</Field>
							<Field label="First fired">
								<span className="tabular-nums">
									{formatDateTime(alert.triggeredAt)}
								</span>
							</Field>
							<Field label="Last fired">
								<span className="tabular-nums">
									{formatDateTime(alert.lastOccurrence)}
								</span>
							</Field>
							{alert.acknowledgedAt && (
								<Field label="Acknowledged">
									<span className="tabular-nums">
										{formatDateTime(alert.acknowledgedAt)}
									</span>
								</Field>
							)}
							{alert.resolvedAt && (
								<Field label="Resolved">
									<span className="tabular-nums">
										{formatDateTime(alert.resolvedAt)}
									</span>
								</Field>
							)}
						</dl>
					</RecordSection>

					{(labels.length > 0 || (alert.tags?.length ?? 0) > 0) && (
						<RecordSection id="labels" title="Labels" count={labels.length}>
							<div className="flex flex-wrap gap-1.5">
								{labels.map(([k, v]) => (
									<StateChip key={k} tone="neutral" mono>
										{k}={v}
									</StateChip>
								))}
								{alert.tags?.map((tag) => (
									<StateChip key={tag} tone="neutral" mono dashed>
										{tag}
									</StateChip>
								))}
							</div>
						</RecordSection>
					)}

					<RecordSection
						id="payload"
						title="Raw payload"
						actions={
							payload ? (
								<>
									<Button
										variant="ghost"
										size="sm"
										className="h-6 px-2 text-meta"
										onClick={() => {
											navigator.clipboard?.writeText(payload);
											toast({ title: "Copied" });
										}}
									>
										<Copy className="mr-1 h-3 w-3" />
										Copy
									</Button>
									<Button
										variant="ghost"
										size="sm"
										className="h-6 px-2 text-meta"
										onClick={() => setPayloadOpen((v) => !v)}
										data-testid="alert-payload-toggle"
									>
										{payloadOpen ? "Fold" : "Unfold"}
									</Button>
								</>
							) : undefined
						}
					>
						{payload ? (
							<pre
								className={
									payloadOpen
										? "overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-meta"
										: "max-h-40 overflow-hidden rounded-md border bg-muted/40 p-3 font-mono text-meta [mask-image:linear-gradient(to_bottom,black_60%,transparent)]"
								}
								data-testid="alert-payload"
							>
								{payload}
							</pre>
						) : (
							<p className="text-record text-muted-foreground">
								The source sent no payload beyond the fields above.
							</p>
						)}
					</RecordSection>
				</div>
			</div>
		</div>
	);
}
