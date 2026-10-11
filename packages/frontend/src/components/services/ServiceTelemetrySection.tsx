// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	SERVICE_METRIC_CONFIG_KEY,
	type ServiceIntegrationWithStatus,
} from "@prismalens/contracts";
import { useState } from "react";
import { RecordSection } from "@/components/shared/RecordSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	useCreateServiceIntegration,
	useDeleteServiceIntegration,
	useUpdateServiceIntegration,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

/** On for this service unless this service turned it off. */
function isOn(i: ServiceIntegrationWithStatus): boolean {
	return (
		!i.hasOverride ||
		(i.serviceConfig as { enabled?: boolean } | null)?.enabled !== false
	);
}

/** The override's config minus `enabled`; null when nothing else is kept. */
export function withoutEnabled(
	i: ServiceIntegrationWithStatus,
): Record<string, unknown> | null {
	const { enabled: _, ...rest } = i.serviceConfig ?? {};
	return Object.keys(rest).length > 0 ? rest : null;
}

/**
 * Telemetry (study-v3 §7): the sources a run on this service may query. The
 * brief names each one that is on; turning one off holds it back for this
 * service only.
 */
export function ServiceTelemetrySection({
	serviceId,
	integrations,
}: {
	serviceId: string;
	integrations: ServiceIntegrationWithStatus[];
}) {
	const create = useCreateServiceIntegration();
	const update = useUpdateServiceIntegration();
	const remove = useDeleteServiceIntegration();
	const pending = create.isPending || update.isPending || remove.isPending;
	const observability = integrations.filter(
		(i) => i.category === "observability",
	);
	const toggle = (i: ServiceIntegrationWithStatus) => {
		const on = isOn(i);
		if (on) {
			if (i.overrideId)
				update.mutate({
					id: i.overrideId,
					config: { ...(i.serviceConfig ?? {}), enabled: false },
				});
			else
				create.mutate({
					serviceId,
					connectionId: i.connectionId,
					config: { enabled: false },
				});
		} else if (i.overrideId) {
			const rest = withoutEnabled(i);
			if (rest) update.mutate({ id: i.overrideId, config: rest });
			else remove.mutate({ id: i.overrideId });
		}
	};
	// The overview charts this when the alert's own query is unknown, labelled as the service's (#811 Q2b).
	const saveMetric = (i: ServiceIntegrationWithStatus, metric: string) => {
		const { [SERVICE_METRIC_CONFIG_KEY]: _, ...rest } = i.serviceConfig ?? {};
		const config = metric
			? { ...rest, [SERVICE_METRIC_CONFIG_KEY]: metric }
			: rest;
		if (i.overrideId) {
			if (Object.keys(config).length > 0)
				update.mutate({ id: i.overrideId, config });
			else remove.mutate({ id: i.overrideId });
		} else if (metric)
			create.mutate({ serviceId, connectionId: i.connectionId, config });
	};
	return (
		<RecordSection id="telemetry" title="Telemetry">
			{observability.length === 0 ? (
				<p className="text-body text-text-2">
					None. Add Alertmanager or Prometheus under Settings, Alert sources and
					the brief tells the agent to query it.
				</p>
			) : (
				<ul className="divide-y divide-hairline">
					{observability.map((i) => {
						const on = isOn(i);
						return (
							<li
								key={i.connectionId}
								className="flex items-start gap-3 py-2.5"
								data-testid="service-telemetry-row"
							>
								<div className="min-w-0 flex-1">
									<p className={cn("text-body", !on && "text-text-3")}>
										{i.connectionName}
									</p>
									<p className="text-meta text-text-3">
										{i.templateName},{" "}
										{on ? (
											i.status === "ACTIVE" ? (
												"reachable. The brief tells the agent to query it."
											) : (
												<span className="text-warn">
													unreachable at the last check.
												</span>
											)
										) : (
											"held back from runs on this service."
										)}
									</p>
									{i.templateId === "prometheus" && on && (
										<MetricField
											value={metricOf(i)}
											disabled={pending}
											onSave={(metric) => saveMetric(i, metric)}
										/>
									)}
								</div>
								<Button
									variant="text"
									size="sm"
									disabled={pending}
									onClick={() => toggle(i)}
								>
									{on ? "Turn off here" : "Turn on"}
								</Button>
							</li>
						);
					})}
				</ul>
			)}
		</RecordSection>
	);
}

function metricOf(i: ServiceIntegrationWithStatus): string {
	const v = i.serviceConfig?.[SERVICE_METRIC_CONFIG_KEY];
	return typeof v === "string" ? v : "";
}

/** The service's own PromQL, charted on an incident's overview when its alert's query is unknown. */
function MetricField({
	value,
	disabled,
	onSave,
}: {
	value: string;
	disabled: boolean;
	onSave: (metric: string) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	if (draft === null)
		return (
			<p className="mt-1 flex min-w-0 items-baseline gap-2 text-meta text-text-3">
				<span className="shrink-0">Impact metric:</span>
				{value ? (
					<code className="min-w-0 truncate font-mono text-text-2">
						{value}
					</code>
				) : (
					<span>none</span>
				)}
				<button
					type="button"
					className="shrink-0 text-accent hover:underline"
					disabled={disabled}
					onClick={() => setDraft(value)}
					data-testid="service-metric-edit"
				>
					{value ? "Change" : "Add"}
				</button>
			</p>
		);
	return (
		<form
			className="mt-1.5 flex flex-col gap-1.5"
			onSubmit={(e) => {
				e.preventDefault();
				onSave(draft.trim());
				setDraft(null);
			}}
		>
			<label className="text-meta text-text-3" htmlFor="service-metric">
				A PromQL query for this service, such as its p99 latency. An incident's
				Impact chart shows it, labelled as the service's metric, when the
				alert's own query is not known. It never decides whether a fix worked.
			</label>
			<Input
				id="service-metric"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				className="font-mono"
				spellCheck={false}
				data-testid="service-metric-input"
			/>
			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={disabled}>
					Save
				</Button>
				<Button
					type="button"
					variant="text"
					size="sm"
					onClick={() => setDraft(null)}
				>
					Cancel
				</Button>
			</div>
		</form>
	);
}
