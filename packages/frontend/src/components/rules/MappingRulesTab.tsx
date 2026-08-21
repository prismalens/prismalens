// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { AlertMappingRuleWithService } from "@prismalens/contracts";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, FlaskConical, Plus, Route } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	useAlertMappingRules,
	useDeleteAlertMappingRule,
	useUpdateAlertMappingRule,
} from "@/lib/api/hooks";
import { MappingRuleFormDialog } from "./MappingRuleFormDialog";
import { DeleteRuleDialog, RuleEnabledToggle } from "./RuleRowControls";
import { TestMappingDialog } from "./TestMappingDialog";

const COLUMNS = [
	"name",
	"service",
	"priority",
	"enabled",
	"updated",
	"rowActions",
] as const;

function LoadingSkeleton() {
	return (
		<>
			{["a", "b", "c"].map((row) => (
				<TableRow key={row}>
					{COLUMNS.map((column) => (
						<TableCell key={`${row}-${column}`}>
							<Skeleton className="h-4 w-[100px]" />
						</TableCell>
					))}
				</TableRow>
			))}
		</>
	);
}

export function MappingRulesTab() {
	const {
		data: rules = [],
		isLoading,
		error,
		refetch,
	} = useAlertMappingRules();

	const [formOpen, setFormOpen] = useState(false);
	const [editingRule, setEditingRule] =
		useState<AlertMappingRuleWithService | null>(null);
	const [testOpen, setTestOpen] = useState(false);
	const [ruleToDelete, setRuleToDelete] =
		useState<AlertMappingRuleWithService | null>(null);

	const updateRule = useUpdateAlertMappingRule();
	const deleteRule = useDeleteAlertMappingRule();

	const openCreate = () => {
		setEditingRule(null);
		setFormOpen(true);
	};

	const openEdit = (rule: AlertMappingRuleWithService) => {
		setEditingRule(rule);
		setFormOpen(true);
	};

	const handleDelete = () => {
		if (!ruleToDelete) return;
		deleteRule.mutate({ id: ruleToDelete.id });
		setRuleToDelete(null);
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between gap-2">
				<p className="text-sm text-muted-foreground">
					Decide which service an incoming alert belongs to. The first match, in
					priority order, wins.
				</p>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="sm" onClick={() => setTestOpen(true)}>
						<FlaskConical className="h-4 w-4 mr-1" />
						Test with sample alert
					</Button>
					<Button size="sm" onClick={openCreate}>
						<Plus className="h-4 w-4 mr-1" />
						Add rule
					</Button>
				</div>
			</div>

			{error ? (
				<div className="flex flex-col items-center text-center py-8 rounded-md border">
					<AlertCircle className="h-5 w-5 text-destructive mb-3" />
					<p className="text-sm text-destructive mb-4">
						{error instanceof Error
							? error.message
							: "Failed to load mapping rules"}
					</p>
					<Button variant="outline" size="sm" onClick={() => refetch()}>
						Retry
					</Button>
				</div>
			) : (
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-[280px]">Name</TableHead>
								<TableHead>Service</TableHead>
								<TableHead>Priority</TableHead>
								<TableHead>Enabled</TableHead>
								<TableHead>Updated</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isLoading ? (
								<LoadingSkeleton />
							) : rules.length === 0 ? (
								<EmptyState
									variant="table-cell"
									colSpan={COLUMNS.length}
									icon={Route}
									title="No alert mapping rules"
									description="Without a mapping rule an incoming alert arrives with no service attached, and nothing routes it."
									actions={
										<Button size="sm" onClick={openCreate}>
											<Plus className="h-4 w-4 mr-1" />
											Add rule
										</Button>
									}
								/>
							) : (
								rules.map((rule) => (
									<TableRow key={rule.id}>
										<TableCell className="font-medium">
											<div className="flex flex-col gap-1">
												<span>{rule.name}</span>
												{rule.description && (
													<span className="text-xs text-muted-foreground">
														{rule.description}
													</span>
												)}
											</div>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{rule.service?.displayName ?? rule.service?.name ?? "—"}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{rule.priority}
										</TableCell>
										<TableCell>
											<RuleEnabledToggle
												ruleId={rule.id}
												ruleName={rule.name}
												enabled={rule.enabled}
												disabled={updateRule.isPending}
												onToggle={(next) =>
													updateRule.mutate({ id: rule.id, enabled: next })
												}
											/>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{formatDistanceToNow(new Date(rule.updatedAt), {
												addSuffix: true,
											})}
										</TableCell>
										<TableCell className="text-right">
											<div className="flex items-center justify-end gap-2">
												<Button
													variant="outline"
													size="sm"
													onClick={() => openEdit(rule)}
												>
													Edit
												</Button>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => setRuleToDelete(rule)}
												>
													Delete
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
			)}

			<MappingRuleFormDialog
				open={formOpen}
				onOpenChange={setFormOpen}
				rule={editingRule}
			/>
			<TestMappingDialog open={testOpen} onOpenChange={setTestOpen} />
			<DeleteRuleDialog
				ruleName={ruleToDelete?.name ?? null}
				onOpenChange={(open) => {
					if (!open) setRuleToDelete(null);
				}}
				onConfirm={handleDelete}
			/>
		</div>
	);
}
