// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type IncidentWithRelations,
	isWorkflowLive,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
	ModelSelector,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorInput,
	ModelSelectorItem,
	ModelSelectorList,
} from "@/components/ai/model-selector";
import { Mono } from "@/components/shared/Mono";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { mergeSentence } from "@/lib/incident-board";

const serviceOf = (i: IncidentWithRelations): string | undefined =>
	i.service?.displayName ||
	i.service?.name ||
	i.services?.[0]?.displayName ||
	i.services?.[0]?.name;

/**
 * Merge into… (#673 w37): pick an open incident, confirm, and the record
 * moves to it. Every alert goes along; this incident ends as merged.
 */
export function MergeDialog({
	open,
	onOpenChange,
	incident,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	incident: IncidentWithRelations;
}) {
	const [target, setTarget] = useState<IncidentWithRelations | null>(null);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { data, isLoading } = useQuery({
		...orpc.incidents.list.queryOptions({ input: { open: true, limit: 100 } }),
		enabled: open,
	});
	const candidates = (data?.data ?? []).filter((i) => i.id !== incident.id);
	const merge = useMutation({
		...orpc.incidents.merge.mutationOptions(),
		onSuccess: (into) => {
			close(false);
			void navigate({ to: "/incidents/$id", params: { id: into.id } });
			void queryClient.invalidateQueries({ queryKey: incidentKeys.all() });
		},
		onError: (error) =>
			toast({
				title: "Not merged",
				description: getErrorMessage(error),
				variant: "destructive",
			}),
	});
	const close = (next: boolean) => {
		if (!next) setTarget(null);
		onOpenChange(next);
	};

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent
				className={target ? undefined : "h-[400px] gap-0 p-0"}
				data-testid="merge-dialog"
			>
				{target ? (
					<>
						<DialogHeader>
							<DialogTitle>
								Merge INC-{incident.number} into INC-{target.number}?
							</DialogTitle>
							<DialogDescription data-testid="merge-sentence">
								{mergeSentence(incident, target, serviceOf(incident))}
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button variant="text" onClick={() => setTarget(null)}>
								Back
							</Button>
							<Button
								variant="primary"
								disabled={merge.isPending}
								onClick={() =>
									merge.mutate({ id: incident.id, targetId: target.id })
								}
								data-testid="confirm-merge"
							>
								Merge
							</Button>
						</DialogFooter>
					</>
				) : (
					<>
						<DialogHeader className="sr-only">
							<DialogTitle>Merge INC-{incident.number} into</DialogTitle>
							<DialogDescription>An open incident</DialogDescription>
						</DialogHeader>
						<ModelSelector className="min-h-0" loop>
							<ModelSelectorInput
								placeholder="Search open incidents"
								data-testid="merge-search"
							/>
							<ModelSelectorList
								label="Open incidents"
								className="[scrollbar-width:thin]"
							>
								<ModelSelectorEmpty>
									{isLoading ? "Loading" : "No other open incident."}
								</ModelSelectorEmpty>
								<ModelSelectorGroup>
									{candidates.map((i) => {
										const service = serviceOf(i);
										return (
											<ModelSelectorItem
												key={i.id}
												value={`INC-${i.number} ${i.title} ${service ?? ""}`}
												onSelect={() => setTarget(i)}
												data-testid="merge-option"
												data-number={i.number}
											>
												<Mono className="shrink-0 text-meta text-text-3">
													INC-{i.number}
												</Mono>
												<span className="grid min-w-0 flex-1">
													<span className="truncate">{i.title}</span>
													<span className="truncate text-meta text-text-3">
														{service ?? "No service"}
														{isWorkflowLive(i.investigations?.[0]?.status ?? "")
															? ", run working"
															: ""}
													</span>
												</span>
											</ModelSelectorItem>
										);
									})}
								</ModelSelectorGroup>
							</ModelSelectorList>
						</ModelSelector>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
