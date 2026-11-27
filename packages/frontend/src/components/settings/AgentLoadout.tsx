// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What loads (#1180 §3.1): what one agent loads for a project and profile, each
 * item with how PrismaLens knows it (on disk, reported by a matching run) and its state.
 */
import {
	type HarnessStatus,
	LOADED_KINDS,
	type LoadedItem,
	type AgentLoadout as Loadout,
} from "@prismalens/contracts";
import { Link, useSearch } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Mark } from "@/components/kit/Mark";
import { MARKS } from "@/components/kit/marks";
import { settingOf } from "@/components/kit/registry";
import { Time } from "@/components/kit/Time";
import { Mono } from "@/components/shared/Mono";
import { Pool, Row } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Loading, Problem } from "@/components/shared/State";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ago, useNow } from "@/hooks/use-now";
import {
	useAgentLoadout,
	useSetSharedMembership,
	useSharedSet,
} from "@/lib/api/hooks/use-agent-setup-orpc";
import { useRepositories } from "@/lib/api/hooks/use-repositories-orpc";

type LoadedKind = (typeof LOADED_KINDS)[number];

const GROUP_TITLE: Readonly<Record<LoadedKind, string>> = {
	instructions: "Instructions",
	plugin: "Plugins",
	skill: "Skills",
	mcp: "MCP servers",
	hook: "Hooks",
};

export const NOT_READABLE = "Not readable for this agent";
export const STALE_REPORT = "Last run had a different setup";
const GLOBAL = "global";

/** The state's word; a PrismaLens item not sent says why in its own note. */
export function loadedStateWord(item: LoadedItem): string {
	if (item.state === "not-sent" && item.note) return item.note;
	return MARKS.loadedState.words[item.state];
}

/** `On disk`, `Reported 2h ago`, or both. */
export function loadedVia(
	item: LoadedItem,
	now: number | null,
): { state: "disk" | "reported"; word: string }[] {
	const words = MARKS.loadedVia.words;
	const via: { state: "disk" | "reported"; word: string }[] = [];
	if (item.disk) via.push({ state: "disk", word: words.disk });
	if (item.reported) {
		const rel = ago(item.reported, now);
		const word = !rel
			? words.reported
			: rel === "now"
				? `${words.reported} now`
				: `${words.reported} ${rel} ago`;
		via.push({ state: "reported", word });
	}
	return via;
}

function ItemRow({ item, now }: { item: LoadedItem; now: number | null }) {
	const key = `${item.kind}-${item.scope}-${item.name}`;
	const state = loadedStateWord(item);
	return (
		<Row
			testId={`loadout-item-${key}`}
			label={item.name}
			meta={item.path ? <Mono>{item.path}</Mono> : undefined}
			trailing={
				<span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-text-2">
					{loadedVia(item, now).map((v) => (
						<Mark
							key={v.state}
							id="loadedVia"
							state={v.state}
							word={v.word}
							testId={`loadout-via-${v.state}`}
						>
							{v.word}
						</Mark>
					))}
					<Mark
						id="loadedState"
						state={item.state}
						word={state}
						testId="loadout-state"
					>
						{state}
					</Mark>
				</span>
			}
		/>
	);
}

/** The loadout as read: the report line, then one group per kind. */
export function AgentLoadoutView({
	loadout,
	now,
}: {
	loadout: Loadout;
	now: number | null;
}) {
	return (
		<div data-testid="agent-loadout-view">
			{loadout.report ? (
				<p
					className="mb-2 flex flex-wrap items-center gap-2 text-meta text-text-3"
					data-testid="loadout-report"
				>
					<Time at={loadout.report.at} now={now} prefix="Reported" past ago />
					<Link
						to="/threads/$id"
						params={{ id: loadout.report.threadId }}
						className="inline-flex min-h-6 items-center text-accent hover:underline"
					>
						Open thread
					</Link>
				</p>
			) : (
				loadout.staleReport && (
					<p className="mb-2 text-meta" data-testid="loadout-stale">
						<Link
							to="/threads/$id"
							params={{ id: loadout.staleReport.threadId }}
							className="inline-flex min-h-6 items-center text-accent hover:underline"
						>
							{STALE_REPORT}
						</Link>
					</p>
				)
			)}
			{loadout.profile === "clean" && (
				<p className="mb-2 text-meta text-text-3" data-testid="loadout-profile">
					Clean profile. Skips your hooks and plugins.
				</p>
			)}
			{LOADED_KINDS.map((kind) => {
				const items = loadout.items.filter((i) => i.kind === kind);
				return (
					<SettingGroup
						key={kind}
						title={GROUP_TITLE[kind]}
						count={loadout.readable ? items.length : undefined}
						className="mt-5"
						testId={`loadout-group-${kind}`}
					>
						{!loadout.readable ? (
							<p className="text-meta text-text-3">{NOT_READABLE}</p>
						) : items.length === 0 ? (
							<p className="text-meta text-text-3">None found</p>
						) : (
							<Pool>
								{items.map((item) => (
									<ItemRow
										key={`${item.scope}-${item.name}-${item.path ?? ""}`}
										item={item}
										now={now}
									/>
								))}
							</Pool>
						)}
					</SettingGroup>
				);
			})}
		</div>
	);
}

/** In every shared server's recipients or the instructions' (`agent.useSharedSet`). */
function UseSharedSetRow({ id }: { id: string }) {
	const set = useSharedSet().data;
	const change = useSetSharedMembership();
	const s = settingOf("agent.useSharedSet");
	const member =
		!!set &&
		(set.instructionsFor.includes(id) ||
			set.servers.some((v) => v.recipients.includes(id)));
	return (
		<Pool>
			<SettingRow
				label={<label htmlFor="agent-use-shared-set">{s.label}</label>}
				description={s.sentence}
				testId="agent-use-shared-set"
			>
				<Switch
					id="agent-use-shared-set"
					checked={member}
					disabled={!set || change.isPending}
					onCheckedChange={(on) => change.mutate({ id, member: on })}
					data-testid="agent-use-shared-set-switch"
				/>
			</SettingRow>
		</Pool>
	);
}

function LoadoutBody({ agent }: { agent: HarnessStatus }) {
	const now = useNow();
	const repos = useRepositories({ limit: 100 });
	const list = repos.data?.data ?? [];
	// The project last changed stands in for the one last worked on: the list carries no run time.
	const recent = [...list].sort((a, b) =>
		b.updatedAt.localeCompare(a.updatedAt),
	)[0];
	const from = useSearch({
		strict: false,
		select: (s: { repositoryId?: string }) => s.repositoryId,
	});
	const cameFrom = list.find((r) => r.id === from);
	const [picked, setPicked] = useState<string | null>(null);
	const project =
		picked ?? (repos.isLoading ? null : (cameFrom?.id ?? recent?.id ?? GLOBAL));
	const loadout = useAgentLoadout(
		{
			id: agent.id,
			...(project && project !== GLOBAL ? { repositoryId: project } : {}),
		},
		project !== null,
	);
	return (
		<div className="mt-3">
			<UseSharedSetRow id={agent.id} />
			<div className="mt-4 mb-2 flex items-center gap-2">
				<Select
					value={project ?? GLOBAL}
					onValueChange={setPicked}
					disabled={project === null}
				>
					<SelectTrigger aria-label="Project" data-testid="loadout-project">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={GLOBAL}>Global</SelectItem>
						{list.map((r) => (
							<SelectItem key={r.id} value={r.id}>
								{r.fullName}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{loadout.isError ? (
				<Problem
					text="Could not read what loads"
					onRetry={() => void loadout.refetch()}
				/>
			) : loadout.data ? (
				<AgentLoadoutView loadout={loadout.data} now={now} />
			) : (
				<Loading rows={3} />
			)}
		</div>
	);
}

/** Folded until opened; opening reads it once, and nothing polls. */
export function AgentLoadout({ agent }: { agent: HarnessStatus }) {
	const [open, setOpen] = useState(false);
	return (
		<details
			className="group mt-8"
			data-testid="agent-loadout"
			onToggle={(e) => setOpen(e.currentTarget.open)}
		>
			<summary className="flex cursor-pointer list-none items-center gap-1.5 text-body font-medium text-text-2 hover:text-text-1 [&::-webkit-details-marker]:hidden">
				<ChevronRight
					aria-hidden
					className="size-3.5 shrink-0 text-text-3 transition-transform duration-(--dur-fast) group-open:rotate-90 motion-reduce:transition-none"
				/>
				What loads
			</summary>
			{open && <LoadoutBody agent={agent} />}
		</details>
	);
}
