// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ACP_MARKS } from "@prismalens/config/acp-marks";
import {
	ACP_REGISTRY,
	type AcpRegistryEntry,
	installLineFor,
} from "@prismalens/config/acp-registry";
import { HARNESS_REGISTRY } from "@prismalens/config/harness";
import { CircleDashed, Search } from "lucide-react";
import { useId, useState } from "react";
import { RegistryMark } from "@/components/agent/AgentMark";
import { CommandChip } from "@/components/ui/command-chip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Registry entries that are not already one of Add agent's tiles (#911). */
export const OTHER_AGENTS: readonly AcpRegistryEntry[] = (() => {
	const tiles = new Set(
		Object.values(HARNESS_REGISTRY).flatMap((d) => d.acpRegistryIds ?? []),
	);
	return ACP_REGISTRY.filter((e) => !tiles.has(e.id));
})();

/** Up to `limit` entries whose name, id or description holds every word of the query. */
export function searchRegistry(
	query: string,
	entries: readonly AcpRegistryEntry[] = OTHER_AGENTS,
	limit = 8,
): AcpRegistryEntry[] {
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	return entries
		.filter((e) => {
			const hay = `${e.name} ${e.id} ${e.description}`.toLowerCase();
			return words.every((w) => hay.includes(w));
		})
		.slice(0, limit);
}

/**
 * "Or find one in the ACP registry" (#848): a search over the registry list
 * bundled with this release. PrismaLens fetches and installs nothing (ADR
 * 0003 §4); choosing an entry shows its install line to copy. It sits under
 * Add agent's tiles and leaves out the agents those tiles already are (#911).
 */
export function AcpRegistrySearch({
	entries = OTHER_AGENTS,
	host,
	onChoose,
}: {
	entries?: readonly AcpRegistryEntry[];
	/** The PrismaLens host's platform; unknown shows every line. */
	host?: { os: string; arch: string };
	onChoose?: (id: string | null) => void;
}) {
	const [query, setQuery] = useState("");
	const [chosen, setChosenState] = useState<string | null>(null);
	const setChosen = (id: string | null) => {
		setChosenState(id);
		onChoose?.(id);
	};
	const id = useId();
	const found = searchRegistry(query, entries);
	return (
		<div className="flex min-w-0 flex-col gap-2" data-testid="acp-registry">
			<label htmlFor={id} className="text-body font-medium">
				Or find one in the ACP registry
			</label>
			<div className="flex h-9 items-center gap-2 rounded-control bg-well-in-pool px-2.5">
				<Search className="size-4 shrink-0 text-text-3" aria-hidden />
				<Input
					id={id}
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setChosen(null);
					}}
					placeholder={`Search ${entries.length} agents`}
					className="h-8 flex-1 bg-transparent px-0"
					data-testid="acp-registry-search"
				/>
			</div>
			{query.trim() && found.length === 0 && (
				<p className="text-meta text-text-2">No agent in the list matches.</p>
			)}
			{found.length > 0 && (
				<ul
					className="flex min-w-0 flex-col gap-1"
					aria-label="Registry agents"
				>
					{found.map((e) => {
						const on = chosen === e.id;
						return (
							<li key={e.id} className="min-w-0">
								<button
									type="button"
									aria-expanded={on}
									onClick={() => setChosen(on ? null : e.id)}
									className={cn(
										"flex min-h-12 w-full items-start gap-3 rounded-control px-2.5 py-2 text-left transition-colors duration-(--dur-instant) hover:bg-surface-3",
										on && "bg-surface-3",
									)}
									data-testid="acp-registry-entry"
								>
									<RegistryMark mark={ACP_MARKS[e.id]} className="mt-0.5" />
									<span className="min-w-0 flex-1">
										<span className="block font-semibold">{e.name}</span>
										<span className="line-clamp-2 text-meta text-text-2">
											{e.description}
										</span>
									</span>
									<span className="inline-flex shrink-0 items-center gap-1 text-meta text-text-2">
										<CircleDashed className="size-3.5" aria-hidden />
										Not installed
									</span>
								</button>
								{on && <InstallLines entry={e} host={host} />}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

/** This host's one install line, the rest behind Other systems (#1180). */
function InstallLines({
	entry,
	host,
}: {
	entry: AcpRegistryEntry;
	host: { os: string; arch: string } | undefined;
}) {
	const [all, setAll] = useState(false);
	const pick = host ? installLineFor(entry, host.os, host.arch) : null;
	return (
		<div className="mt-1 mb-2 flex min-w-0 flex-col gap-1.5 pl-2.5">
			{pick && "line" in pick && (
				<CommandChip command={pick.line} testId="acp-registry-install" />
			)}
			{pick && "none" in pick && (
				<p className="text-meta text-text-2" data-testid="acp-registry-none">
					{pick.none}
				</p>
			)}
			{pick && entry.install.length > 1 && (
				<button
					type="button"
					aria-expanded={all}
					onClick={() => setAll(!all)}
					className="self-start text-meta text-text-2 underline-offset-2 hover:underline"
					data-testid="acp-registry-other"
				>
					Other systems
				</button>
			)}
			{(!pick || all) &&
				entry.install.map((line) => (
					<CommandChip
						key={line}
						command={line}
						testId={
							pick ? "acp-registry-install-other" : "acp-registry-install"
						}
					/>
				))}
		</div>
	);
}
