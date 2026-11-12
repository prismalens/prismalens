// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	USAGE_RANGES,
	type UsageLimits,
	type UsageRange,
	type UsageSummary,
} from "@prismalens/contracts";
import { type ReactNode, useEffect, useState } from "react";
import { Segmented } from "@/components/shared/Segmented";
import { Loading, Problem } from "@/components/shared/State";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	useUsageLimits,
	useUsageSummary,
} from "@/lib/api/hooks/use-usage-orpc";
import { UsageLimitsPanel } from "./UsageLimitsPanel";
import { UsageCost, UsageTokens } from "./UsageReport";
import { agentName } from "./usage-math";

export type UsageTab = "tokens" | "cost" | "limits";

/** What a panel shows while its query is in flight, failed or done. */
export type Loadable<T> =
	| { status: "loading" }
	| { status: "error"; retry?: () => void }
	| { status: "ready"; data: T };

const ALL = "all";

function ScopeSelect({
	label,
	all,
	value,
	options,
	onChange,
	testId,
}: {
	label: string;
	all: string;
	value: string | undefined;
	options: { id: string; name: string }[];
	onChange: (value: string | undefined) => void;
	testId: string;
}) {
	return (
		<Select
			value={value ?? ALL}
			onValueChange={(v) => onChange(v === ALL ? undefined : v)}
		>
			<SelectTrigger
				aria-label={label}
				className="max-w-48 max-sm:h-11"
				data-testid={testId}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value={ALL}>{all}</SelectItem>
				{options.map((o) => (
					<SelectItem key={o.id} value={o.id}>
						{o.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function Loaded<T>({
	state,
	what,
	children,
}: {
	state: Loadable<T>;
	what: string;
	children: (data: T) => ReactNode;
}) {
	if (state.status === "loading") return <Loading rows={4} />;
	if (state.status === "error")
		return <Problem text={`${what} did not load.`} onRetry={state.retry} />;
	return children(state.data);
}

/** The Usage view from data: range and scope, then Tokens, Cost and Limits. */
export function UsagePanel({
	range,
	onRangeChange,
	project,
	onProjectChange,
	agent,
	onAgentChange,
	tab,
	onTabChange,
	summary,
	limits,
	now,
}: {
	range: UsageRange;
	onRangeChange: (range: UsageRange) => void;
	project?: string;
	onProjectChange: (project: string | undefined) => void;
	agent?: string;
	onAgentChange: (agent: string | undefined) => void;
	tab: UsageTab;
	onTabChange: (tab: UsageTab) => void;
	summary: Loadable<UsageSummary>;
	limits: Loadable<UsageLimits>;
	now: number;
}) {
	const scope = summary.status === "ready" ? summary.data : undefined;
	return (
		<div className="grid min-w-0 gap-4" data-testid="usage-view">
			<div className="flex flex-wrap items-center gap-2">
				<Segmented
					label="Range"
					value={range}
					onChange={onRangeChange}
					options={USAGE_RANGES.map((r) => ({ value: r, label: r }))}
					className="max-sm:[&_button]:h-10"
					testId="usage-range"
				/>
				<ScopeSelect
					label="Project"
					all="All projects"
					value={project}
					options={scope?.projects ?? []}
					onChange={onProjectChange}
					testId="usage-project"
				/>
				<ScopeSelect
					label="Agent"
					all="All agents"
					value={agent}
					options={(scope?.agents ?? []).map((id) => ({
						id,
						name: agentName(id),
					}))}
					onChange={onAgentChange}
					testId="usage-agent"
				/>
			</div>
			<Tabs value={tab} onValueChange={(v) => onTabChange(v as UsageTab)}>
				<TabsList className="max-sm:h-11">
					<TabsTrigger value="tokens" className="max-sm:h-11">
						Tokens
					</TabsTrigger>
					<TabsTrigger value="cost" className="max-sm:h-11">
						Cost
					</TabsTrigger>
					<TabsTrigger value="limits" className="max-sm:h-11">
						Limits
					</TabsTrigger>
				</TabsList>
				<TabsContent value="tokens">
					<Loaded state={summary} what="Usage">
						{(s) => <UsageTokens summary={s} />}
					</Loaded>
				</TabsContent>
				<TabsContent value="cost">
					<Loaded state={summary} what="Usage">
						{(s) => <UsageCost summary={s} />}
					</Loaded>
				</TabsContent>
				<TabsContent value="limits">
					<Loaded state={limits} what="Limits">
						{(l) => <UsageLimitsPanel limits={l} now={now} />}
					</Loaded>
				</TabsContent>
			</Tabs>
		</div>
	);
}

function toLoadable<T>(q: {
	data: T | undefined;
	isError: boolean;
	refetch: () => unknown;
}): Loadable<T> {
	if (q.data !== undefined) return { status: "ready", data: q.data };
	if (q.isError) return { status: "error", retry: () => void q.refetch() };
	return { status: "loading" };
}

/** Tokens, cost and usage windows from what the agents reported (#1101 cat 17). */
export function UsageView() {
	const [range, setRange] = useState<UsageRange>("7d");
	const [project, setProject] = useState<string>();
	const [agent, setAgent] = useState<string>();
	const [tab, setTab] = useState<UsageTab>("tokens");
	const summary = useUsageSummary({ range, project, agent });
	const limits = useUsageLimits(tab === "limits");
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (tab !== "limits") return;
		setNow(Date.now());
		const id = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(id);
	}, [tab]);
	return (
		<UsagePanel
			range={range}
			onRangeChange={setRange}
			project={project}
			onProjectChange={setProject}
			agent={agent}
			onAgentChange={setAgent}
			tab={tab}
			onTabChange={setTab}
			summary={toLoadable(summary)}
			limits={toLoadable(limits)}
			now={now}
		/>
	);
}
