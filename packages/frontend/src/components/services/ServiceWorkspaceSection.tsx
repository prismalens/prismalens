// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunWorkspaceOverride } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	describeField,
	FIELDS,
	FieldEditor,
	type WorkspaceField,
} from "@/components/run-workspace/WorkspaceFields";
import { MutationError } from "@/components/shared/MutationError";
import { RecordSection } from "@/components/shared/RecordSection";
import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/api/orpc-client";

export const FROM_GLOBAL = "From global settings";

/** A service's Workspace (#925): each field its own, or "From global settings". */
export function ServiceWorkspaceSection({ serviceId }: { serviceId: string }) {
	const queryClient = useQueryClient();
	const query = useQuery(
		orpc.runWorkspaces.getService.queryOptions({ input: { serviceId } }),
	);
	const global = useQuery(orpc.runWorkspaces.get.queryOptions());
	const [draft, setDraft] = useState<RunWorkspaceOverride | null>(null);
	const saved = query.data?.override;
	useEffect(() => {
		if (saved) setDraft(saved);
	}, [saved]);
	const update = useMutation({
		...orpc.runWorkspaces.updateService.mutationOptions(),
		onSuccess: (data) =>
			queryClient.setQueryData(
				orpc.runWorkspaces.getService.queryKey({ input: { serviceId } }),
				data,
			),
	});
	if (!query.data || !global.data || !draft) return null;
	const { canEdit } = query.data;
	const base = global.data.settings;
	const where = global.data.defaultLocation;
	const value = { ...base, ...draft };
	const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
	const own = (key: WorkspaceField) => draft[key] !== undefined;
	const toggle = (key: WorkspaceField) => {
		const next = { ...draft };
		if (own(key)) delete next[key];
		else (next as Record<string, unknown>)[key] = base[key];
		setDraft(next);
	};
	return (
		<RecordSection id="workspace" title="Workspace">
			<p className="py-2 text-meta text-text-2">
				Where this service's runs check out a local repo, and what happens to it
				afterwards.
			</p>
			{FIELDS.map(({ key, label }) => (
				<div
					key={key}
					className="flex min-h-14 flex-col justify-center gap-2 border-t border-hairline py-3 first:border-t-0"
					data-testid={`service-workspace-${key}`}
				>
					<div className="flex items-center gap-4">
						<div className="min-w-0 flex-1">
							<p className="font-semibold">{label}</p>
							{!own(key) && (
								<p className="truncate text-meta text-text-2">
									{FROM_GLOBAL} · {describeField(key, base, where)}
								</p>
							)}
						</div>
						{canEdit && (
							<Button size="sm" variant="text" onClick={() => toggle(key)}>
								{own(key) ? "Use global" : "Set for this service"}
							</Button>
						)}
					</div>
					{own(key) && (
						<FieldEditor
							field={key}
							value={value}
							defaultLocation={where}
							onChange={(k, v) => setDraft({ ...draft, [k]: v })}
							disabled={!canEdit}
						/>
					)}
				</div>
			))}
			{canEdit && dirty && (
				<div className="mt-2 flex items-center gap-2">
					<Button
						size="sm"
						disabled={update.isPending}
						onClick={() => update.mutate({ serviceId, override: draft })}
						data-testid="service-workspace-save"
					>
						Save
					</Button>
					<Button
						size="sm"
						variant="text"
						disabled={update.isPending}
						onClick={() => setDraft(saved ?? {})}
					>
						Discard
					</Button>
				</div>
			)}
			<MutationError error={update.error} className="mt-2" />
		</RecordSection>
	);
}
