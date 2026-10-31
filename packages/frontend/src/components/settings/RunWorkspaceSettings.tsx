// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	KEPT_WORKSPACES_WARN_OVER,
	type RunWorkspaceGlobal,
	type ServiceKeptWorkspace,
	type RunWorkspaceSettings as Settings,
	type WorkspaceRemoval,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { KeptWorkspaceRows } from "@/components/run/KeptWorkspaces";
import {
	FIELDS,
	FieldEditor,
	HELP,
	REASONS,
} from "@/components/run-workspace/WorkspaceFields";
import { Mono } from "@/components/shared/Mono";
import { MutationError } from "@/components/shared/MutationError";
import { Pool, Row } from "@/components/shared/Row";
import { SettingGroup } from "@/components/shared/SettingRow";
import { Empty } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { orpc } from "@/lib/api/orpc-client";

/** Settings → Runs → Workspace (#925): the global settings, and what was removed and why. */
export function RunWorkspaceSettings() {
	const queryClient = useQueryClient();
	const query = useQuery(orpc.runWorkspaces.get.queryOptions());
	const removals = useQuery(orpc.runWorkspaces.removals.queryOptions());
	const [draft, setDraft] = useState<Settings | null>(null);
	const saved = query.data?.settings;
	useEffect(() => {
		if (saved) setDraft(saved);
	}, [saved]);
	const update = useMutation({
		...orpc.runWorkspaces.update.mutationOptions(),
		onSuccess: (data) => {
			queryClient.setQueryData(orpc.runWorkspaces.get.queryKey(), data);
			void queryClient.invalidateQueries({
				queryKey: orpc.runWorkspaces.key(),
			});
		},
	});
	if (!query.data || !draft) return null;
	const { defaultLocation, canEdit } = query.data;
	const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
	return (
		<>
			<SettingGroup
				title="Workspace"
				description={
					canEdit
						? "Where a run's checkout of the code lives and what happens to it afterwards. Each service can override any field."
						: "Only the computer PrismaLens runs on can change these: setup and teardown run commands there."
				}
				testId="run-workspace-settings"
			>
				<Pool>
					{FIELDS.map(({ key, label }) => (
						<Row
							key={key}
							label={label}
							meta={HELP[key]}
							stackOnPhone
							testId={`workspace-field-${key}`}
							below={
								<div className="mt-2">
									<FieldEditor
										field={key}
										value={draft}
										defaultLocation={defaultLocation}
										onChange={(k, v) => setDraft({ ...draft, [k]: v })}
										disabled={!canEdit}
									/>
								</div>
							}
						/>
					))}
				</Pool>
				{canEdit && (
					<div className="mt-3 flex items-center gap-2">
						<Button
							size="sm"
							disabled={!dirty || update.isPending}
							onClick={() => update.mutate(draft)}
							data-testid="run-workspace-save"
						>
							Save
						</Button>
						<Button
							size="sm"
							variant="text"
							disabled={!dirty || update.isPending}
							onClick={() => setDraft(saved ?? null)}
						>
							Discard
						</Button>
						<MutationError error={update.error} />
					</div>
				)}
			</SettingGroup>
			<KeptOverLimit />
			{query.data.copies && (
				<CopiesGroup copies={query.data.copies} canEdit={canEdit} />
			)}
			<SettingGroup
				title="Recent removals"
				count={removals.data?.removals.length}
				testId="run-workspace-removals"
			>
				{removals.data?.removals.length ? (
					<Pool>
						{removals.data.removals.slice(0, 30).map((r) => (
							<RemovalRow key={`${r.dir}-${r.at}`} removal={r} />
						))}
					</Pool>
				) : (
					<Empty text="No workspace has been removed or kept yet." />
				)}
			</SettingGroup>
		</>
	);
}

/** No cap removes kept work (#925): a service holding too many is named, with Remove on each. */
function KeptOverLimit() {
	const options = orpc.runWorkspaces.kept.queryOptions();
	const query = useQuery(options);
	const byService = new Map<string, ServiceKeptWorkspace[]>();
	for (const w of query.data?.workspaces ?? [])
		byService.set(w.serviceId, [...(byService.get(w.serviceId) ?? []), w]);
	const over = Array.from(byService.values()).filter(
		(kept) => kept.length > KEPT_WORKSPACES_WARN_OVER,
	);
	return over.map((kept) => {
		const name = kept[0]?.serviceName ?? kept[0]?.serviceId;
		return (
			<SettingGroup
				key={kept[0]?.serviceId}
				title={`Kept workspaces of ${name}`}
				count={kept.length}
				testId="kept-over-limit"
				description={
					<span className="flex items-start gap-1.5 text-warn">
						<TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
						{name} holds more than {KEPT_WORKSPACES_WARN_OVER} kept workspaces.
						Nothing removes them for their number; remove the ones you no longer
						need.
					</span>
				}
			>
				<Pool className="px-3 py-1">
					<KeptWorkspaceRows
						workspaces={kept}
						canEdit={query.data?.canEdit ?? false}
						refresh={options.queryKey}
					/>
				</Pool>
			</SettingGroup>
		);
	});
}

function RemovalRow({ removal: r }: { removal: WorkspaceRemoval }) {
	const reason = REASONS[r.reason] ?? r.reason;
	const teardown =
		r.teardown && r.teardown.status !== "ok"
			? ` Teardown ${r.teardown.status === "capped" ? "was cut off at 60 seconds" : "failed"}.`
			: "";
	return (
		<Row
			label={<Mono className="truncate">{r.dir}</Mono>}
			meta={`${r.removed ? "Removed" : "Kept"}: ${reason}.${teardown} ${new Date(r.at).toLocaleString()}`}
		/>
	);
}

/** Where a git URL is cloned once (#925); global only, since one copy serves every service. */
function CopiesGroup({
	copies,
	canEdit,
}: {
	copies: RunWorkspaceGlobal["copies"];
	canEdit: boolean;
}) {
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState(copies.location ?? "");
	useEffect(() => setDraft(copies.location ?? ""), [copies.location]);
	const update = useMutation({
		...orpc.runWorkspaces.updateCopies.mutationOptions(),
		onSuccess: (data) =>
			queryClient.setQueryData(orpc.runWorkspaces.get.queryKey(), data),
	});
	const next = draft.trim() || null;
	const dirty = next !== (copies.location ?? null);
	return (
		<SettingGroup
			title="Git URLs"
			description="A git URL is cloned once, into this folder, and fetched after that. Each run's workspace is a worktree or a clone of that copy, as Method says."
			testId="run-workspace-copies"
		>
			<Pool>
				<Row
					label="Cloned copies"
					meta={
						copies.previous.length
							? `New copies go here. Copies still in ${copies.previous.join(", ")} are used until no kept workspace needs them, then removed.`
							: "Changing it clones each URL again on its next run; the old copies are removed once no kept workspace uses them."
					}
					stackOnPhone
					below={
						<div className="mt-2 flex flex-wrap items-center gap-2">
							<Input
								aria-label="Cloned copies"
								placeholder={copies.defaultLocation}
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								disabled={!canEdit}
								className="min-w-0 flex-1 basis-64 font-mono"
							/>
							{canEdit && (
								<Button
									size="sm"
									disabled={!dirty || update.isPending}
									onClick={() => update.mutate({ location: next })}
									data-testid="run-workspace-copies-save"
								>
									Save
								</Button>
							)}
						</div>
					}
				/>
			</Pool>
			<MutationError error={update.error} className="mt-2" />
		</SettingGroup>
	);
}
