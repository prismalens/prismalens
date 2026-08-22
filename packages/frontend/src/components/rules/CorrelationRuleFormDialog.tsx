// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { CorrelationAction, CorrelationRule } from "@prismalens/contracts";
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
	useCreateCorrelationRule,
	useUpdateCorrelationRule,
} from "@/lib/api/hooks";
import {
	CORRELATION_CRITERIA_SAMPLE,
	parseMatchCriteria,
} from "./rule-samples";

export interface CorrelationRuleFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Pass an existing rule for edit mode, null/undefined for create mode */
	rule?: CorrelationRule | null;
	onSuccess?: () => void;
}

/** The contract enum, and nothing beyond it — the engine honours exactly these. */
const ACTIONS: { value: CorrelationAction; label: string }[] = [
	{ value: "correlate", label: "Correlate into an incident" },
	{ value: "suppress", label: "Suppress the alert" },
	{ value: "create_incident", label: "Create a new incident" },
];

export function CorrelationRuleFormDialog({
	open,
	onOpenChange,
	rule,
	onSuccess,
}: CorrelationRuleFormDialogProps) {
	const isEditing = !!rule;

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [action, setAction] = useState<CorrelationAction>("correlate");
	const [timeWindowMinutes, setTimeWindowMinutes] = useState("60");
	const [priority, setPriority] = useState("0");
	const [enabled, setEnabled] = useState(true);
	const [criteria, setCriteria] = useState(CORRELATION_CRITERIA_SAMPLE);
	const [error, setError] = useState<string | null>(null);

	const createRule = useCreateCorrelationRule();
	const updateRule = useUpdateCorrelationRule();
	const isPending = createRule.isPending || updateRule.isPending;

	useEffect(() => {
		if (open) {
			if (rule) {
				setName(rule.name);
				setDescription(rule.description || "");
				setAction(rule.action);
				setTimeWindowMinutes(String(rule.timeWindowMinutes));
				setPriority(String(rule.priority));
				setEnabled(rule.enabled);
				setCriteria(JSON.stringify(rule.matchCriteria, null, 2));
			} else {
				setName("");
				setDescription("");
				setAction("correlate");
				setTimeWindowMinutes("60");
				setPriority("0");
				setEnabled(true);
				setCriteria(CORRELATION_CRITERIA_SAMPLE);
			}
			setError(null);
		}
	}, [rule, open]);

	const handleSubmit = async () => {
		if (!name.trim()) {
			setError("Name is required");
			return;
		}

		const parsed = parseMatchCriteria(criteria);
		if (!parsed.ok) {
			setError(parsed.error);
			return;
		}

		const window = Number(timeWindowMinutes);
		if (!Number.isInteger(window) || window < 1) {
			setError("Time window must be a whole number of minutes, at least 1");
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
					action,
					timeWindowMinutes: window,
					priority: rulePriority,
					enabled,
					matchCriteria: parsed.value,
				});
			} else {
				await createRule.mutateAsync({
					name: name.trim(),
					description: description || undefined,
					action,
					timeWindowMinutes: window,
					priority: rulePriority,
					enabled,
					matchCriteria: parsed.value,
				});
			}
			onOpenChange(false);
			onSuccess?.();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to save correlation rule";
			setError(message);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{isEditing ? "Edit correlation rule" : "Add correlation rule"}
					</DialogTitle>
					<DialogDescription>
						Correlation rules run on every incoming alert, in priority order.
						The first matching rule decides what happens to it.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="correlation-rule-name">
							Name <span className="text-destructive">*</span>
						</Label>
						<Input
							id="correlation-rule-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Suppress checkout noise"
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="correlation-rule-description">Description</Label>
						<Textarea
							id="correlation-rule-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="What this rule is for..."
							rows={2}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="correlation-rule-action">Action</Label>
						<Select
							value={action}
							onValueChange={(v) => setAction(v as CorrelationAction)}
						>
							<SelectTrigger id="correlation-rule-action">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{ACTIONS.map((a) => (
									<SelectItem key={a.value} value={a.value}>
										{a.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="correlation-rule-window">
								Time window (minutes)
							</Label>
							<Input
								id="correlation-rule-window"
								type="number"
								min={1}
								value={timeWindowMinutes}
								onChange={(e) => setTimeWindowMinutes(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="correlation-rule-priority">Priority</Label>
							<Input
								id="correlation-rule-priority"
								type="number"
								value={priority}
								onChange={(e) => setPriority(e.target.value)}
							/>
							<p className="text-xs text-muted-foreground">Lower runs first</p>
						</div>
					</div>

					<div className="flex items-center gap-2">
						<Checkbox
							id="correlation-rule-enabled"
							checked={enabled}
							onCheckedChange={(checked) => setEnabled(checked === true)}
						/>
						<Label htmlFor="correlation-rule-enabled">Enabled</Label>
					</div>

					<div className="space-y-2">
						<Label htmlFor="correlation-rule-criteria">Match criteria</Label>
						<Textarea
							id="correlation-rule-criteria"
							className="font-mono text-xs"
							value={criteria}
							onChange={(e) => setCriteria(e.target.value)}
							rows={8}
						/>
						<p className="text-xs text-muted-foreground">
							JSON object. Predicates go under <code>match</code>:{" "}
							<code>tags</code>, <code>severity</code>, <code>service</code>,{" "}
							<code>source</code>. All present predicates must hold.
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
					<Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
						{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						{isEditing ? "Save changes" : "Create rule"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
