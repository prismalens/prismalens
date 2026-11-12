// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	USAGE_RANGES,
	type UsageLimits,
	type UsageRange,
	type UsageSummary,
} from "@prismalens/contracts";
import { CalendarRange, FolderGit2, Layers } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import { Picker, TabPanel, Tabs } from "@/components/kit";
import { MARKS } from "@/components/kit/marks";
import { Loading, Problem } from "@/components/shared/State";
import {
	useUsageLimits,
	useUsageSummary,
} from "@/lib/api/hooks/use-usage-orpc";
import { AgentGap, UsageLimitsPanel } from "./UsageLimitsPanel";
import { UsageCost, UsageTokens } from "./UsageReport";
import { agentGap, agentName } from "./usage-math";

export type UsageTab = "tokens" | "cost" | "limits";

/** What a panel shows while its query is in flight, failed or done. */
export type Loadable<T> =
	| { status: "loading" }
	| { status: "error"; retry?: () => void }
	| { status: "ready"; data: T };

const ALL = "all";
const RANGE_WORD: Record<UsageRange, string> = {
	"24h": "24 hours",
	"7d": "7 days",
	"30d": "30 days",
};

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
		<div className="grid min-w-0 gap-3" data-testid="usage-view">
			<div className="flex flex-wrap items-center gap-1 max-sm:[&_button]:min-h-11">
				<Picker
					label="Range"
					side="bottom"
					value={range}
					onChange={(v) => onRangeChange(v as UsageRange)}
					options={USAGE_RANGES.map((r) => ({
						id: r,
						name: RANGE_WORD[r],
						icon: CalendarRange,
					}))}
					testId="usage-range"
				/>
				<Picker
					label="Project"
					side="bottom"
					value={project ?? ALL}
					onChange={(v) => onProjectChange(v === ALL ? undefined : v)}
					options={[
						{ id: ALL, name: "All projects", icon: Layers },
						...(scope?.projects ?? []).map((p) => ({
							id: p.id,
							name: p.name,
							icon: FolderGit2,
						})),
					]}
					testId="usage-project"
				/>
				<Picker
					label="Agent"
					side="bottom"
					value={agent ?? ALL}
					onChange={(v) => onAgentChange(v === ALL ? undefined : v)}
					options={[
						{ id: ALL, name: "All agents", icon: MARKS.agent.icon },
						...(scope?.agents ?? []).map((id) => ({
							id,
							name: agentName(id),
							mark: <AgentMark id={id} className="size-3.5" />,
						})),
					]}
					testId="usage-agent"
				/>
			</div>
			<div className="max-sm:[&_[role=tab]]:min-h-11">
				<Tabs
					label="Usage"
					value={tab}
					onValueChange={(v) => onTabChange(v as UsageTab)}
					items={[
						{ value: "tokens", label: "Tokens", testId: "usage-tab-tokens" },
						{ value: "cost", label: "Cost", testId: "usage-tab-cost" },
						{ value: "limits", label: "Limits", testId: "usage-tab-limits" },
					]}
				>
					<TabPanel value="tokens">
						<Loaded state={summary} what="Usage">
							{(s) => <UsageTokens summary={s} />}
						</Loaded>
					</TabPanel>
					<TabPanel value="cost">
						<Loaded state={summary} what="Usage">
							{(s) => <UsageCost summary={s} />}
						</Loaded>
					</TabPanel>
					<TabPanel value="limits">
						<Loaded state={limits} what="Limits">
							{(l) => <UsageLimitsPanel limits={l} now={now} />}
						</Loaded>
					</TabPanel>
				</Tabs>
			</div>
			{scope && tab !== "limits" && <AgentGaps summary={scope} />}
		</div>
	);
}

/** One short line per agent in scope whose usage data is partial or absent (sheet §7). */
function AgentGaps({ summary }: { summary: UsageSummary }) {
	const silent = new Set(summary.silentAgents);
	const rows = summary.agents.filter((a) => silent.has(a) || agentGap(a));
	if (rows.length === 0) return null;
	return (
		<ul className="flex flex-wrap gap-x-4 gap-y-1" data-testid="usage-gaps">
			{rows.map((a) => (
				<li key={a} className="inline-flex min-w-0 items-center gap-1.5">
					<AgentMark id={a} className="size-3.5" />
					<span className="text-meta text-text-2">{agentName(a)}</span>
					<AgentGap agent={a} silent={silent.has(a)} />
				</li>
			))}
		</ul>
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
