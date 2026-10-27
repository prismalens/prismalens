// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	RunWorkspaceSettings as Settings,
	WorkspaceRemoval,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
						? "Where a run's checkout of a local repo lives and what happens to it afterwards. Each service can override any field."
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
