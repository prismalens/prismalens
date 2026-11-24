// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GitHostView, HostRepository } from "@prismalens/contracts";
import { Lock } from "lucide-react";
import { useDeferredValue, useState } from "react";
import {
	SOURCE_KINDS,
	SourceConnectDialog,
} from "@/components/settings/SourceConnectDialog";
import { ProjectMark } from "@/components/shared/ProjectMark";
import { Loading, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHostRepositories } from "@/lib/api/hooks/use-app-settings-orpc";
import { getErrorMessage } from "@/lib/get-error-message";
import { shortAge } from "@/lib/incident-board";

export interface HostChoice {
	host: string;
	label: string;
	/** The Add source kind that connects it. */
	kindId: string;
	/** A credential PrismaLens can use is stored, in the environment or on the machine. */
	connected: boolean;
}

/**
 * Every git host Add source offers, in its order, then any other host with a
 * credential by name. The order never depends on which token exists.
 */
export function hostChoices(hosts: readonly GitHostView[]): HostChoice[] {
	const byHost = new Map(hosts.map((h) => [h.host.toLowerCase(), h]));
	const isConnected = (h?: GitHostView) =>
		!!h && (h.stored.length > 0 || !!h.env || !!h.machine);
	const declared = SOURCE_KINDS.filter((k) => k.git).map((k) => {
		const host = new URL(k.url).host;
		return {
			host,
			label: k.label,
			kindId: k.id,
			connected: isConnected(byHost.get(host)),
		};
	});
	const known = new Set(declared.map((d) => d.host));
	const extra = hosts
		.filter((h) => !known.has(h.host.toLowerCase()))
		.map((h) => ({
			host: h.host,
			label: h.host,
			kindId: "gitlab",
			connected: isConnected(h),
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
	return [...declared, ...extra];
}

/** A host's repositories, most recently pushed first; a pick hands back its clone URL. */
export function HostRepoPicker({
	choice,
	onChoose,
	pending,
}: {
	choice: HostChoice;
	onChoose: (url: string) => void;
	pending: boolean;
}) {
	const [search, setSearch] = useState("");
	const [connecting, setConnecting] = useState(false);
	const list = useHostRepositories(
		choice.host,
		useDeferredValue(search.trim()),
	);
	const repos = list.data?.repositories ?? [];

	if (list.data?.credential === "none")
		return (
			<div
				className="grid justify-items-start gap-2 py-2"
				data-testid="host-repos-connect"
			>
				<p className="text-body text-text-2">No {choice.label} token yet.</p>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						onClick={() => setConnecting(true)}
						data-testid="host-repos-connect-button"
					>
						Connect {choice.label}
					</Button>
				</div>
				{connecting && (
					<SourceConnectDialog
						open
						onOpenChange={(o) => {
							setConnecting(o);
							if (!o) void list.refetch();
						}}
						initialKind={choice.kindId}
					/>
				)}
			</div>
		);

	return (
		<div className="grid gap-2" data-testid="host-repos">
			<Input
				autoFocus
				value={search}
				onChange={(e) => setSearch(e.target.value)}
				placeholder={`Search ${choice.label}`}
				aria-label={`Search ${choice.label} repositories`}
				data-testid="host-repos-search"
			/>
			{list.isLoading ? (
				<Loading rows={4} />
			) : list.error ? (
				<Problem
					text={getErrorMessage(list.error)}
					onRetry={() => void list.refetch()}
				/>
			) : repos.length === 0 ? (
				<p
					className="px-1 py-2 text-meta text-text-3"
					data-testid="host-repos-empty"
				>
					{search ? "No repository matches" : "No repositories"}
				</p>
			) : (
				<ul
					className="grid max-h-72 gap-px overflow-y-auto rounded-surface bg-surface-1 p-1"
					aria-label={`${choice.label} repositories`}
					data-testid="host-repos-list"
				>
					{repos.map((r) => (
						<RepoRow
							key={r.url}
							repo={r}
							disabled={pending}
							onPick={() => onChoose(r.url)}
						/>
					))}
					{list.data?.hasMore && (
						<li className="px-2 py-1 text-meta text-text-3">
							Search to find more
						</li>
					)}
				</ul>
			)}
		</div>
	);
}

function RepoRow({
	repo,
	disabled,
	onPick,
}: {
	repo: HostRepository;
	disabled: boolean;
	onPick: () => void;
}) {
	return (
		<li>
			<button
				type="button"
				disabled={disabled}
				onClick={onPick}
				className="flex min-h-9 w-full items-center gap-2 rounded-control px-2 py-1 text-left text-body text-text-1 hover:bg-surface-3 disabled:opacity-60"
				data-testid="host-repo"
			>
				<ProjectMark
					name={repo.fullName}
					iconUrl={repo.ownerAvatarUrl}
					size="sm"
				/>
				<span className="min-w-0 flex-1 truncate">{repo.fullName}</span>
				{repo.private && (
					<Lock
						className="size-3.5 shrink-0 text-text-3"
						aria-label="Private"
					/>
				)}
				{repo.pushedAt && (
					<span className="shrink-0 text-meta text-text-3">
						{shortAge(repo.pushedAt, Date.now())}
					</span>
				)}
			</button>
		</li>
	);
}
