// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	GitCredentialDisplay,
	Repository,
	ServiceWithRelations,
} from "@prismalens/contracts";
import { useState } from "react";
import { Hint } from "@/components/shared/Hint";
import { Mono } from "@/components/shared/Mono";
import { MutationError } from "@/components/shared/MutationError";
import { RecordSection } from "@/components/shared/RecordSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	useAddRepositorySource,
	useSetRepositoryCredential,
	useUnlinkRepository,
} from "@/lib/api/hooks";
import { credentialLabel } from "@/lib/investigation-events";

const AUTO = "auto";

/** The saved token a repository is pinned to, from its metadata. */
function pinOf(repo: Repository): string | null {
	const pick = repo.metadata?.credentialConnectionId;
	return typeof pick === "string" && pick ? pick : null;
}

/**
 * Auto or one saved token for the row's host (#673): shown when two tokens match,
 * or once a token is pinned, so the pin can be changed or set back to Auto.
 */
function CredentialPicker({
	repo,
	credential,
}: {
	repo: Repository;
	credential: GitCredentialDisplay;
}) {
	const set = useSetRepositoryCredential();
	const pin = pinOf(repo);
	const candidates = credential.problem?.candidates ?? [];
	const options =
		pin && !candidates.some((c) => c.connectionId === pin)
			? [
					...candidates,
					{
						connectionId: pin,
						label: credential.label.replace(/^token /, ""),
						fingerprint: credential.fingerprint ?? "",
					},
				]
			: candidates;
	return (
		<div className="mt-1 flex flex-wrap items-center gap-2">
			<Select
				value={pin ?? AUTO}
				disabled={set.isPending}
				onValueChange={(v) =>
					set.mutate({ id: repo.id, connectionId: v === AUTO ? null : v })
				}
			>
				<SelectTrigger
					className="h-7 w-auto min-w-32"
					aria-label="Which token this repository clones with"
					data-testid="service-code-credential-picker"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={AUTO}>Auto</SelectItem>
					{options.map((c) => (
						<SelectItem key={c.connectionId} value={c.connectionId}>
							{c.fingerprint ? `${c.label}, fp ${c.fingerprint}` : c.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<MutationError error={set.error} />
		</div>
	);
}

/**
 * Code the run reads (study-v3 §7): the folder or git URL a run copies, with
 * the branch and the commit it last read, and which credential git uses for it
 * (#673). Add takes either.
 */
export function ServiceCodeSection({
	service,
}: {
	service: ServiceWithRelations;
}) {
	const [adding, setAdding] = useState(false);
	const [source, setSource] = useState("");
	const add = useAddRepositorySource();
	const unlink = useUnlinkRepository();
	const repos = service.repositories ?? [];
	return (
		<RecordSection
			id="code"
			title="Code the run reads"
			actions={
				!adding && (
					<Button variant="text" size="sm" onClick={() => setAdding(true)}>
						Add
					</Button>
				)
			}
		>
			{repos.length === 0 && !adding && (
				<p className="text-body text-text-2">
					None, so a run on this service reads no code.
				</p>
			)}
			<ul className="divide-y divide-hairline">
				{repos.map((sr) => {
					const r = sr.repository;
					const where =
						sr.subPath && r.sourceKind === "folder"
							? `${r.url}/${sr.subPath}`
							: r.url;
					const line = [
						r.sourceKind === "folder" ? "Folder on this machine" : "Git URL",
						r.syncBranch ? `branch ${r.syncBranch}` : null,
						r.syncHead ? `last read at ${r.syncHead.slice(0, 7)}` : null,
					]
						.filter(Boolean)
						.join(", ");
					const credential = r.credential;
					const picker =
						r.sourceKind === "url" &&
						credential &&
						(credential.problem?.code === "ambiguous" || !!pinOf(r));
					return (
						<li
							key={sr.id}
							className="flex items-start gap-3 py-2.5"
							data-testid="service-code-row"
						>
							<div className="min-w-0 flex-1">
								<Hint label={where}>
									<Mono
										tabIndex={0}
										className="block truncate rounded-[2px] text-left text-text-1 [direction:rtl] focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
									>
										<bdi>{where}</bdi>
									</Mono>
								</Hint>
								<p className="text-meta text-text-2">
									{line}
									{credential && (
										<>
											{", "}
											<span
												title={credential.via}
												data-testid="service-code-credential"
											>
												Code: {credentialLabel(credential)}
											</span>
										</>
									)}
								</p>
								{credential?.problem && (
									<p
										className="text-meta text-danger"
										data-testid="service-code-credential-problem"
									>
										{credential.problem.message}
									</p>
								)}
								{r.syncError && (
									<p className="text-meta text-danger">{r.syncError}</p>
								)}
								{picker && credential && (
									<CredentialPicker repo={r} credential={credential} />
								)}
							</div>
							<Button
								variant="danger"
								size="sm"
								disabled={unlink.isPending}
								onClick={() =>
									unlink.mutate({ id: r.id, serviceId: service.id })
								}
							>
								Stop reading it
							</Button>
						</li>
					);
				})}
			</ul>
			{adding && (
				<form
					className="mt-2 flex flex-col gap-2 sm:flex-row"
					onSubmit={(e) => {
						e.preventDefault();
						add.mutate(
							{ serviceId: service.id, source: source.trim() },
							{
								onSuccess: () => {
									setAdding(false);
									setSource("");
								},
							},
						);
					}}
				>
					<Input
						autoFocus
						value={source}
						onChange={(e) => setSource(e.target.value)}
						placeholder="~/code/payments or git@github.com:acme/payments.git"
						aria-label="A folder on this machine or a git URL"
						className="flex-1"
						data-testid="service-code-input"
					/>
					<Button
						type="submit"
						variant="secondary"
						disabled={!source.trim() || add.isPending}
					>
						Add
					</Button>
					<Button type="button" variant="text" onClick={() => setAdding(false)}>
						Cancel
					</Button>
				</form>
			)}
			<MutationError error={add.error ?? unlink.error} className="mt-2" />
		</RecordSection>
	);
}
