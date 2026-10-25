// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	GitHostView,
	SourceRow,
	TestConnectionResponse,
} from "@prismalens/contracts/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	Boxes,
	GitBranch,
	Pencil,
	RefreshCw,
	TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useTestConnection } from "@/lib/api/hooks";
import { useSetRepositoryCredential } from "@/lib/api/hooks/use-repositories-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";
import {
	AlsoInNote,
	CredentialChip,
	credentialWord,
	hostCredentialWord,
	OverridesNote,
	StatePill,
	sourceState,
	tokenState,
} from "./source-words";

/** What the row's actions hand up; the page owns the dialogs so none nests (OBJ-013). */
export interface SourceActions {
	onEdit: (connectionId: string) => void;
	onDelete: (connectionId: string) => void;
	onAddToken: (host: string) => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div>
			<h4 className="mb-2 text-meta font-medium text-text-2">{title}</h4>
			{children}
		</div>
	);
}

/** A failure in its own words, at its colour, with the icon. */
function Callout({ children }: { children: ReactNode }) {
	return (
		<div
			className="flex items-start gap-2.5 rounded-pool bg-warn/10 px-3 py-2.5 text-text-1"
			role="note"
			data-testid="source-error"
		>
			<TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
			<span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
		</div>
	);
}

/** Test's answer: Connected, or why not; a healthy row keeps no time (case 7). */
function TestAnswer({
	result,
	error,
}: {
	result?: TestConnectionResponse;
	error?: unknown;
}) {
	if (error)
		return (
			<p role="status" className="text-meta text-danger">
				Test did not run: {getErrorMessage(error)}
			</p>
		);
	if (!result) return null;
	if (result.success)
		return (
			<p role="status">
				<StatePill word={{ text: "Connected", tone: "ok" }} />
			</p>
		);
	if (result.untested)
		return (
			<p role="status" className="text-meta text-text-2">
				{result.details?.join("; ") ??
					"Nothing to try yet; it stays Not tested yet."}
			</p>
		);
	return (
		<p role="status" className="text-meta text-danger">
			{(result.details?.length
				? result.details
				: [result.error ?? "Failed"]
			).join("; ")}
		</p>
	);
}

function TestButton({
	connectionId,
	size = "sm",
}: {
	connectionId: string;
	size?: "sm" | "default";
}) {
	const test = useTestConnection();
	return (
		<>
			<Button
				variant="secondary"
				size={size}
				disabled={test.isPending}
				onClick={() => test.mutate({ id: connectionId })}
				data-testid="source-test-saved"
			>
				<RefreshCw
					className={cn(
						"size-3.5",
						test.isPending && "motion-safe:animate-spin",
					)}
				/>
				Test
			</Button>
			<span className="order-last basis-full">
				<TestAnswer result={test.data} error={test.error} />
			</span>
		</>
	);
}

/** A telemetry connection's details: the error, address, credential, who uses it, Test and Edit. */
export function ConnectionDetail({
	row,
	actions,
	alsoInAlertIntake = true,
}: {
	row: SourceRow;
	actions: SourceActions;
	alsoInAlertIntake?: boolean;
}) {
	const word = sourceState(row);
	return (
		<div className="flex flex-col gap-4" data-testid="source-detail">
			{word.tone !== "ok" && row.lastErrorMessage && (
				<Callout>{row.lastErrorMessage}</Callout>
			)}
			<Section title="Address">
				<p className="font-mono text-mono [overflow-wrap:anywhere]">
					{row.address ?? "None"}
				</p>
			</Section>
			<Section title="Credential">
				<div className="flex flex-wrap items-center gap-2">
					<CredentialChip text={credentialWord(row)} />
					{row.overridesEnv && <OverridesNote variable={row.overridesEnv} />}
				</div>
			</Section>
			<Section title="Used by">
				{row.usedBy.length ? (
					<div className="flex flex-wrap gap-1.5">
						{row.usedBy.map((u) => (
							<Link
								key={u.serviceId}
								to="/services/$id"
								params={{ id: u.serviceId }}
								className="inline-flex h-[22px] items-center gap-1.5 rounded-control bg-surface-3 px-2 text-meta text-text-1 hover:bg-surface-4"
							>
								<Boxes className="size-[13px] text-text-2" aria-hidden />
								{u.name}
							</Link>
						))}
					</div>
				) : (
					<p className="text-text-2">No service uses it yet.</p>
				)}
			</Section>
			{alsoInAlertIntake && row.alsoInAlertIntake && (
				<AlsoInNote page="Alert intake" />
			)}
			<div className="flex flex-wrap items-center gap-2">
				<TestButton connectionId={row.connectionId} />
				<Button
					variant="secondary"
					size="sm"
					onClick={() => actions.onEdit(row.connectionId)}
					data-testid="source-edit"
				>
					<Pencil className="size-3.5" />
					Edit
				</Button>
				<Button
					variant="danger"
					size="sm"
					className="ml-auto"
					onClick={() => actions.onDelete(row.connectionId)}
					data-testid="source-delete"
				>
					Delete
				</Button>
			</div>
		</div>
	);
}

/** "Pick a token": pins one stored token to each repository that names none (gap 3). */
function PickToken({ host }: { host: GitHostView }) {
	const pin = useSetRepositoryCredential();
	const queryClient = useQueryClient();
	return (
		<div className="flex flex-col gap-2" data-testid="pick-token">
			{host.unpinnedRepos.map((r) => (
				<div
					key={r.repositoryId}
					className="flex flex-wrap items-center justify-between gap-2"
				>
					<span className="min-w-0 truncate font-mono text-mono">{r.url}</span>
					<Select
						onValueChange={(connectionId) =>
							pin.mutate(
								{ id: r.repositoryId, connectionId },
								{
									onSuccess: () =>
										queryClient.invalidateQueries({
											queryKey: orpc.sources.key(),
										}),
								},
							)
						}
					>
						<SelectTrigger
							aria-label={`Token for ${r.url}`}
							className="w-48"
							data-testid="pick-token-select"
						>
							<SelectValue placeholder="Pick a token" />
						</SelectTrigger>
						<SelectContent>
							{host.stored.map((t) => (
								<SelectItem key={t.connectionId} value={t.connectionId}>
									{t.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			))}
		</div>
	);
}

/** A git host's details: which tokens it holds and their state, the env token, or your own git. */
export function HostDetail({
	host,
	actions,
}: {
	host: GitHostView;
	actions: SourceActions;
}) {
	return (
		<div className="flex flex-col gap-4" data-testid="host-detail">
			{host.ambiguous && (
				<>
					<Callout>
						Two tokens and a repository with no pin. Pick the token each one
						clones with.
					</Callout>
					<PickToken host={host} />
				</>
			)}
			<Section title="Credential">
				<CredentialChip text={hostCredentialWord(host)} />
			</Section>
			{host.stored.length > 0 && (
				<ul className="flex flex-col divide-y divide-hairline rounded-pool bg-well-in-pool px-3">
					{host.stored.map((t) => (
						<li key={t.connectionId} className="flex flex-col gap-1.5 py-2.5">
							<div className="flex flex-wrap items-center gap-2">
								<span className="font-medium">{t.label}</span>
								<StatePill word={tokenState(t)} testId="token-state" />
							</div>
							<div className="flex flex-wrap gap-1.5">
								{t.pinnedRepos.length ? (
									t.pinnedRepos.map((r) => (
										<span
											key={r.repositoryId}
											className="inline-flex h-[22px] items-center gap-1.5 rounded-control bg-surface-3 px-2 font-mono text-mono"
										>
											<GitBranch className="size-3 text-text-2" aria-hidden />
											{r.url}
										</span>
									))
								) : (
									<span className="text-meta text-text-2">
										No repository pinned
									</span>
								)}
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<TestButton connectionId={t.connectionId} />
								<Button
									variant="text"
									size="sm"
									onClick={() => actions.onEdit(t.connectionId)}
								>
									Edit
								</Button>
								<Button
									variant="danger"
									size="sm"
									onClick={() => actions.onDelete(t.connectionId)}
								>
									Delete
								</Button>
							</div>
						</li>
					))}
				</ul>
			)}
			{host.env && (
				<div className="flex flex-wrap items-center gap-2">
					<CredentialChip text="From environment" />
					<code className="rounded-[4px] bg-surface-3 px-1 font-mono text-mono">
						{host.env.variable}
					</code>
				</div>
			)}
			{!host.stored.length && !host.env && (
				<p className="text-text-2">Clones use your own git.</p>
			)}
			<div>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => actions.onAddToken(host.host)}
					data-testid="host-add-token"
				>
					Add a token
				</Button>
			</div>
		</div>
	);
}
