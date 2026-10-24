// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	SERVICE_METRIC_CONFIG_KEY,
	type ServiceIntegrationWithStatus,
	type SourcesPreRun,
} from "@prismalens/contracts";
import { Boxes, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Field } from "@/components/settings/Field";
import {
	hostOf,
	KindIcon,
	kindLabel,
} from "@/components/settings/source-words";
import { RecordSection } from "@/components/shared/RecordSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
	useCreateServiceIntegration,
	useDeleteServiceIntegration,
	useUpdateServiceIntegration,
} from "@/lib/api/hooks";
import { useSourcesPreRun } from "@/lib/api/hooks/use-sources-orpc";
import { cn } from "@/lib/utils";
import { ServiceConnectionsMatrix } from "./ServiceConnectionsMatrix";

const KINDS = ["prometheus", "alertmanager", "loki"] as const;

/** A label-matcher list, like `{app="checkout"}`; a bare metric or `or` is refused (C4). */
const SELECTOR =
	/^\{\s*[A-Za-z_][A-Za-z0-9_]*\s*(=|!=|=~|!~)\s*"[^"]*"\s*(,\s*[A-Za-z_][A-Za-z0-9_]*\s*(=|!=|=~|!~)\s*"[^"]*"\s*)*,?\s*\}$/;

export function selectorProblem(v: string): string | null {
	const t = v.trim();
	if (!t || SELECTOR.test(t)) return null;
	return 'This is not a list of label matchers. Write it like {app="checkout"}, not a bare metric name like up.';
}

/** The mapping's config minus `enabled`; null when nothing else is kept. */
export function withoutEnabled(
	i: ServiceIntegrationWithStatus,
): Record<string, unknown> | null {
	const { enabled: _, ...rest } = i.serviceConfig ?? {};
	return Object.keys(rest).length > 0 ? rest : null;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const configOf = (i: ServiceIntegrationWithStatus) => i.serviceConfig ?? {};
/** A mapping is on unless its config turned it off; off excludes it everywhere (C5). */
const isOn = (i: ServiceIntegrationWithStatus) =>
	i.hasOverride && configOf(i).enabled !== false;
const addressOf = (i: ServiceIntegrationWithStatus) =>
	str(i.globalConfig?.baseUrl);

/**
 * Connections (#848): what a run on this service reads before it starts, per
 * kind. A mapped row has its switch (`config.enabled`) and its deployment
 * and selector edited in place; with several deployments the matrix shows
 * the server's own answer for each. Row order and priority are not shown
 * yet: the service list carries no priority (stopped, see the PR).
 */
export function ServiceTelemetrySection({
	serviceId,
	integrations,
}: {
	serviceId: string;
	integrations: ServiceIntegrationWithStatus[];
}) {
	const preview = useSourcesPreRun(serviceId);
	const byKind = KINDS.map((k) => ({
		kind: k,
		rows: integrations.filter((i) => i.templateId === k),
	})).filter((g) => g.rows.length > 0);
	const deployments = preview.data?.deploymentsSeen ?? [];
	return (
		<RecordSection id="telemetry" title="Connections">
			{byKind.length === 0 ? (
				<p className="text-body text-text-2">
					None. Add Prometheus, Alertmanager or Loki under Settings, Sources,
					then map it here.
				</p>
			) : (
				<div className="flex flex-col gap-6">
					{deployments.length > 1 && (
						<ServiceConnectionsMatrix
							serviceId={serviceId}
							deployments={deployments}
						/>
					)}
					{byKind.map((g) => (
						<div key={g.kind} data-testid={`service-kind-${g.kind}`}>
							<h3 className="mb-2 flex items-baseline gap-2 text-heading">
								{kindLabel(g.kind)}
								<span className="font-normal text-text-3 tabular-nums">
									{g.rows.filter((r) => r.hasOverride).length || ""}
								</span>
							</h3>
							<ul className="raised flex flex-col divide-y divide-hairline rounded-pool px-4">
								{g.rows.map((i) => (
									<ConnectionRow
										key={i.connectionId}
										serviceId={serviceId}
										item={i}
										preview={preview.data}
										deployments={deployments}
									/>
								))}
							</ul>
						</div>
					))}
				</div>
			)}
		</RecordSection>
	);
}

/** What the server's resolver says an unmapped connection does for this service. */
function unmappedLine(
	i: ServiceIntegrationWithStatus,
	preview: SourcesPreRun | undefined,
): string {
	const unit = preview?.kinds
		.find((k) => k.kind === i.templateId)
		?.units.find((u) => u.connectionId === i.connectionId);
	return unit ? "Used for every deployment" : "Not used by this service";
}

function ConnectionRow({
	serviceId,
	item,
	preview,
	deployments,
}: {
	serviceId: string;
	item: ServiceIntegrationWithStatus;
	preview: SourcesPreRun | undefined;
	deployments: string[];
}) {
	const create = useCreateServiceIntegration();
	const update = useUpdateServiceIntegration();
	const remove = useDeleteServiceIntegration();
	const [open, setOpen] = useState(false);
	const pending = create.isPending || update.isPending || remove.isPending;
	const config = configOf(item);
	const deployment = str(config.deployment);
	const selector = str(config.selector);
	const on = isOn(item);
	const moreId = useId();
	return (
		<li className="py-3" data-testid="service-telemetry-row">
			<div className="flex items-start gap-3">
				<KindIcon kind={item.templateId} />
				<div className="min-w-0 flex-1">
					<p className="text-heading">{item.connectionName}</p>
					<p className="truncate font-mono text-mono text-text-2">
						{hostOf(addressOf(item))}
					</p>
					{item.hasOverride ? (
						<p className="mt-1.5 flex flex-wrap items-center gap-1.5">
							<span
								className={cn(
									"inline-flex h-[22px] items-center gap-1.5 rounded-control px-2 text-meta",
									deployment
										? "bg-surface-3 text-text-1"
										: "text-text-2 outline-1 -outline-offset-1 outline-text-3/60",
								)}
								data-testid="mapping-deployment"
							>
								<Boxes className="size-[13px] text-text-2" aria-hidden />
								{deployment || "Any deployment"}
							</span>
							{selector && (
								<code className="inline-flex h-[22px] items-center rounded-control bg-surface-3 px-2 font-mono text-mono">
									{selector}
								</code>
							)}
						</p>
					) : (
						<p className="text-meta text-text-2">
							{unmappedLine(item, preview)}
						</p>
					)}
				</div>
				{item.hasOverride && item.overrideId ? (
					<span className="flex shrink-0 items-center gap-1">
						<Switch
							checked={on}
							disabled={pending}
							onCheckedChange={(v) =>
								item.overrideId &&
								update.mutate({
									id: item.overrideId,
									config: { ...config, enabled: v },
								})
							}
							aria-label={`Use ${item.connectionName} for this service`}
							data-testid="mapping-switch"
						/>
						<Button
							variant="text"
							size="icon"
							aria-expanded={open}
							aria-controls={moreId}
							aria-label={`Edit the mapping of ${item.connectionName}`}
							onClick={() => setOpen(!open)}
						>
							<ChevronDown
								className={cn(
									"size-4 transition-transform duration-(--dur-fast)",
									open && "rotate-180",
								)}
							/>
						</Button>
					</span>
				) : (
					<Button
						variant="secondary"
						size="sm"
						disabled={pending}
						onClick={() =>
							create.mutate({
								serviceId,
								connectionId: item.connectionId,
								config: {},
							})
						}
						data-testid="mapping-add"
					>
						Add
					</Button>
				)}
			</div>
			{open && item.overrideId && (
				<div id={moreId} className="mt-3 pl-11">
					<MappingEditor
						item={item}
						deployments={deployments}
						pending={pending}
						onSave={(next) =>
							item.overrideId &&
							update.mutate(
								{ id: item.overrideId, config: next },
								{ onSuccess: () => setOpen(false) },
							)
						}
						onRemove={() =>
							item.overrideId && remove.mutate({ id: item.overrideId })
						}
					/>
				</div>
			)}
		</li>
	);
}

/** Deployment, selector and, for Prometheus, the impact metric: one save. */
function MappingEditor({
	item,
	deployments,
	pending,
	onSave,
	onRemove,
}: {
	item: ServiceIntegrationWithStatus;
	deployments: string[];
	pending: boolean;
	onSave: (config: Record<string, unknown>) => void;
	onRemove: () => void;
}) {
	const config = configOf(item);
	const [deployment, setDeployment] = useState(str(config.deployment));
	const [selector, setSelector] = useState(str(config.selector));
	const [metric, setMetric] = useState(str(config[SERVICE_METRIC_CONFIG_KEY]));
	const [tried, setTried] = useState(false);
	const ids = { d: useId(), s: useId(), m: useId(), list: useId() };
	const selError = selectorProblem(selector);
	const tagError =
		deployment.trim().length > 64 ? "Use 64 characters or fewer." : null;
	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(e) => {
				e.preventDefault();
				setTried(true);
				if (selError || tagError) return;
				const {
					deployment: _d,
					selector: _s,
					[SERVICE_METRIC_CONFIG_KEY]: _m,
					...rest
				} = config;
				onSave({
					...rest,
					...(deployment.trim() ? { deployment: deployment.trim() } : {}),
					...(selector.trim() ? { selector: selector.trim() } : {}),
					...(metric.trim()
						? { [SERVICE_METRIC_CONFIG_KEY]: metric.trim() }
						: {}),
				});
			}}
			data-testid="mapping-editor"
		>
			<Field
				label="Deployment tag"
				htmlFor={ids.d}
				hint={
					deployments.length
						? `Leave empty to match any deployment. Seen lately: ${deployments.join(", ")}.`
						: "Leave empty to match any deployment."
				}
				error={tried && tagError}
			>
				<Input
					id={ids.d}
					value={deployment}
					onChange={(e) => setDeployment(e.target.value)}
					list={ids.list}
					placeholder="prod-eu"
				/>
			</Field>
			<datalist id={ids.list}>
				{deployments.map((d) => (
					<option key={d} value={d} />
				))}
			</datalist>
			<Field
				label={
					item.templateId === "alertmanager"
						? "Selector (filter matchers)"
						: "Selector"
				}
				htmlFor={ids.s}
				hint={'Label matchers only, like {app="checkout"}.'}
				error={tried && selError}
			>
				<Input
					id={ids.s}
					value={selector}
					onChange={(e) => setSelector(e.target.value)}
					className="font-mono"
					spellCheck={false}
					placeholder='{app="checkout"}'
					data-testid="mapping-selector"
				/>
			</Field>
			{item.templateId === "prometheus" && (
				<Field
					label="Impact metric"
					htmlFor={ids.m}
					hint="A PromQL query for this service. An incident's Impact chart shows it, labelled as the service's metric, when the alert's own query is not known."
				>
					<Input
						id={ids.m}
						value={metric}
						onChange={(e) => setMetric(e.target.value)}
						className="font-mono"
						spellCheck={false}
						data-testid="service-metric-input"
					/>
				</Field>
			)}
			<div className="flex flex-wrap gap-2">
				<Button type="submit" variant="primary" size="sm" disabled={pending}>
					Save
				</Button>
				<Button
					type="button"
					variant="danger"
					size="sm"
					className="ml-auto"
					disabled={pending}
					onClick={onRemove}
				>
					Remove from this service
				</Button>
			</div>
		</form>
	);
}
