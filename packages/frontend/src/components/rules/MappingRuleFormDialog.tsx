// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { AlertMappingRuleWithService } from "@prismalens/contracts";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	useCreateAlertMappingRule,
	useServices,
	useUpdateAlertMappingRule,
} from "@/lib/api/hooks";
import { MAPPING_CRITERIA_SAMPLE, parseMatchCriteria } from "./rule-samples";

export interface MappingRuleFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Pass an existing rule for edit mode, null/undefined for create mode */
	rule?: AlertMappingRuleWithService | null;
	onSuccess?: () => void;
}

export function MappingRuleFormDialog({
	open,
	onOpenChange,
	rule,
	onSuccess,
}: MappingRuleFormDialogProps) {
	const isEditing = !!rule;

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [serviceId, setServiceId] = useState("");
	const [priority, setPriority] = useState("0");
	const [enabled, setEnabled] = useState(true);
	const [criteria, setCriteria] = useState(MAPPING_CRITERIA_SAMPLE);
	const [error, setError] = useState<string | null>(null);

	const { data: servicesResponse } = useServices({ limit: 100 });
	const services = servicesResponse?.data ?? [];

	const createRule = useCreateAlertMappingRule();
	const updateRule = useUpdateAlertMappingRule();
	const isPending = createRule.isPending || updateRule.isPending;

	useEffect(() => {
		if (open) {
			if (rule) {
				setName(rule.name);
				setDescription(rule.description || "");
				setServiceId(rule.serviceId);
				setPriority(String(rule.priority));
				setEnabled(rule.enabled);
				setCriteria(JSON.stringify(rule.matchCriteria, null, 2));
			} else {
				setName("");
				setDescription("");
				setServiceId("");
				setPriority("0");
				setEnabled(true);
				setCriteria(MAPPING_CRITERIA_SAMPLE);
			}
			setError(null);
		}
	}, [rule, open]);

	const handleSubmit = async () => {
		if (!name.trim()) {
			setError("Name is required");
			return;
		}
		if (!serviceId) {
			setError("Service is required");
			return;
		}

		const parsed = parseMatchCriteria(criteria);
		if (!parsed.ok) {
			setError(parsed.error);
			return;
		}

		const rulePriority = Number(priority);
		if (!Number.isInteger(rulePriority)) {
			setError("Priority must be a whole number");
			return;
		}

		setError(null);

		try {
			if (isEditing && rule) {
				await updateRule.mutateAsync({
					id: rule.id,
					name: name.trim(),
					description: description || undefined,
					serviceId,
					priority: rulePriority,
					enabled,
					matchCriteria: parsed.value,
				});
			} else {
				await createRule.mutateAsync({
					name: name.trim(),
					description: description || undefined,
					serviceId,
					priority: rulePriority,
					enabled,
					matchCriteria: parsed.value,
				});
			}
			onOpenChange(false);
			onSuccess?.();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to save mapping rule";
			setError(message);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{isEditing ? "Edit mapping rule" : "Add mapping rule"}
					</DialogTitle>
					<DialogDescription>
						Mapping rules decide which service an incoming alert belongs to. The
						first matching rule, in priority order, wins.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="mapping-rule-name">
							Name <span className="text-destructive">*</span>
						</Label>
						<Input
							id="mapping-rule-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Prometheus checkout alerts"
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="mapping-rule-description">Description</Label>
						<Textarea
							id="mapping-rule-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="What this rule is for..."
							rows={2}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="mapping-rule-service">
							Service <span className="text-destructive">*</span>
						</Label>
						<Select value={serviceId} onValueChange={setServiceId}>
							<SelectTrigger id="mapping-rule-service">
								<SelectValue placeholder="Select a service" />
							</SelectTrigger>
							<SelectContent>
								{services.map((s) => (
									<SelectItem key={s.id} value={s.id}>
										{s.displayName || s.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="mapping-rule-priority">Priority</Label>
							<Input
								id="mapping-rule-priority"
								type="number"
								value={priority}
								onChange={(e) => setPriority(e.target.value)}
							/>
							<p className="text-xs text-muted-foreground">Lower runs first</p>
						</div>
						<div className="flex items-center gap-2 pt-8">
							<Checkbox
								id="mapping-rule-enabled"
								checked={enabled}
								onCheckedChange={(checked) => setEnabled(checked === true)}
							/>
							<Label htmlFor="mapping-rule-enabled">Enabled</Label>
						</div>
					</div>

					<div className="space-y-2">
						<Label htmlFor="mapping-rule-criteria">Match criteria</Label>
						<Textarea
							id="mapping-rule-criteria"
							className="font-mono text-xs"
							value={criteria}
							onChange={(e) => setCriteria(e.target.value)}
							rows={8}
						/>
						<p className="text-xs text-muted-foreground">
							JSON object with <code>source</code>, <code>labels</code> (values
							may use <code>*</code> wildcards), and <code>tags</code>. All
							present predicates must hold.
						</p>
					</div>

					{error && (
						<p className="text-sm text-destructive text-center">{error}</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={isPending || !name.trim() || !serviceId}
					>
						{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						{isEditing ? "Save changes" : "Create rule"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
