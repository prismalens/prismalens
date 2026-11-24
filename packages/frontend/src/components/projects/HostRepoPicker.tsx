// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { GitHostView, HostRepository } from "@prismalens/contracts";
import {
	GIT_HOST_SLUG,
	GIT_HOSTS,
	type GitHostKind,
	publicGitHostKind,
} from "@prismalens/contracts/schemas";
import { Lock } from "lucide-react";
import { useDeferredValue, useId, useState } from "react";
import { SourceConnectDialog } from "@/components/settings/SourceConnectDialog";
import { ProjectMark } from "@/components/shared/ProjectMark";
import { Loading, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useHostRepositories } from "@/lib/api/hooks/use-app-settings-orpc";
import { getErrorMessage } from "@/lib/get-error-message";
import { shortAge } from "@/lib/incident-board";

export interface HostChoice {
	host: string;
	label: string;
	/** A credential PrismaLens can use is stored, in the environment or on the machine. */
	connected: boolean;
	stored?: GitHostView["stored"];
}

export function hostChoices(hosts: readonly GitHostView[]): HostChoice[] {
	const choices = new Map<string, HostChoice>();
	for (const { host, label } of Object.values(GIT_HOSTS)) {
		choices.set(host, { host, label, connected: false });
	}
	for (const h of hosts) {
		choices.set(h.host, {
			host: h.host,
			label: choices.get(h.host)?.label ?? h.host,
			connected: h.stored.length > 0 || !!h.env || !!h.machine,
			stored: h.stored,
		});
	}
	return Array.from(choices.values());
}

export function connectKindFor(host: string): GitHostKind {
	return publicGitHostKind(host) ?? "gitlab";
}

/** A host's repositories, most recently pushed first; a pick hands back its clone URL. */
export function HostRepoPicker({
	choice,
	onChoose,
	onPasteUrl,
	pending,
}: {
	choice: HostChoice;
	onChoose: (url: string, credentialConnectionId?: string) => void;
	onPasteUrl: () => void;
	pending: boolean;
}) {
	const [search, setSearch] = useState("");
	const [workspace, setWorkspace] = useState("");
	const workspaceId = useId();
	const [picked, setPicked] = useState("");
	const stored = choice.stored ?? [];
	const credential =
		stored.length === 1
			? stored[0]
			: stored.find((token) => token.connectionId === picked);
	const needsCredential = stored.length > 1 && !credential;
	const kind = connectKindFor(choice.host);
	const workspaceRequired = GIT_HOSTS[kind].scope === "workspace";
	const scope = useDeferredValue(workspace.trim());
	const ready =
		!needsCredential &&
		(!workspaceRequired || (scope.length <= 100 && GIT_HOST_SLUG.test(scope)));
	const [connecting, setConnecting] = useState(false);
	const list = useHostRepositories(
		ready && choice.connected ? choice.host : null,
		useDeferredValue(search.trim()),
		workspaceRequired ? scope : undefined,
		credential?.connectionId,
	);
	const repos = list.data?.repositories ?? [];

	if (!choice.connected || list.data?.credential === "none")
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
					<Button
						type="button"
						variant="text"
						onClick={onPasteUrl}
						data-testid="host-repos-paste"
					>
						Paste a URL instead
					</Button>
				</div>
				{connecting && (
					<SourceConnectDialog
						open
						onOpenChange={(o) => {
							setConnecting(o);
							if (!o) void list.refetch();
						}}
						initialKind={kind}
						initialUrl={`https://${choice.host}`}
					/>
				)}
			</div>
		);

	return (
		<div className="grid gap-2" data-testid="host-repos">
			{stored.length > 1 && (
				<Select
					value={credential?.connectionId ?? ""}
					onValueChange={setPicked}
				>
					<SelectTrigger aria-label="Saved token">
						<SelectValue placeholder="Choose a saved token" />
					</SelectTrigger>
					<SelectContent>
						{stored.map((token) => (
							<SelectItem key={token.connectionId} value={token.connectionId}>
								{token.label} ({token.fingerprint})
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
			{workspaceRequired && (
				<div className="grid gap-1 text-body">
					<label htmlFor={workspaceId}>{choice.label} workspace</label>
					<Input
						id={workspaceId}
						autoFocus
						value={workspace}
						maxLength={100}
						onChange={(e) => setWorkspace(e.target.value)}
					/>
				</div>
			)}
			{!ready ? (
				<Button variant="text" onClick={onPasteUrl}>
					Paste a repository URL
				</Button>
			) : (
				<>
					<Input
						autoFocus={!workspaceRequired}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder={`Search ${choice.label}`}
						aria-label={`Search ${choice.label} repositories`}
						data-testid="host-repos-search"
					/>
					{list.isLoading ? (
						<Loading rows={4} />
					) : list.error ? (
						<div className="grid justify-items-start gap-2">
							<Problem
								text={getErrorMessage(list.error)}
								onRetry={() => void list.refetch()}
							/>
							<Button variant="text" onClick={onPasteUrl}>
								Paste a repository URL
							</Button>
						</div>
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
									onPick={() =>
										credential
											? onChoose(r.url, credential.connectionId)
											: onChoose(r.url)
									}
								/>
							))}
							{list.data?.hasMore && (
								<li className="px-2 py-1 text-meta text-text-3">
									Search to find more
								</li>
							)}
						</ul>
					)}
				</>
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
