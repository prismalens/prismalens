// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	DEFAULT_TRIGGER_POLICY,
	type TriggerPolicy,
} from "@prismalens/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateService } from "@/lib/api/hooks";

interface InvestigationPolicy {
	trigger: TriggerPolicy;
	context: string;
}

interface ServiceInvestigationTabProps {
	serviceId: string;
	metadata: Record<string, unknown> | null;
}

const TRIGGER_OPTIONS: { value: TriggerPolicy; label: string }[] = [
	{ value: "always", label: "Always investigate" },
	{ value: "critical_and_high", label: "Critical and High severity only" },
	{ value: "critical_only", label: "Critical severity only" },
	{ value: "never", label: "Never auto-investigate" },
];

function parseInvestigationPolicy(
	metadata: Record<string, unknown> | null,
): InvestigationPolicy {
	const investigation = metadata?.investigation as
		| Partial<InvestigationPolicy>
		| undefined;

	return {
		trigger: investigation?.trigger ?? DEFAULT_TRIGGER_POLICY,
		context: investigation?.context ?? "",
	};
}

export function ServiceInvestigationTab({
	serviceId,
	metadata,
}: ServiceInvestigationTabProps) {
	const defaults = parseInvestigationPolicy(metadata);
	const [trigger, setTrigger] = useState<TriggerPolicy>(defaults.trigger);
	const [context, setContext] = useState(defaults.context);

	const updateService = useUpdateService();

	const [saveError, setSaveError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	function handleSave() {
		setSaveError(null);
		setSaved(false);
		updateService.mutate(
			{
				id: serviceId,
				metadata: {
					...metadata,
					investigation: {
						trigger,
						context,
					},
				},
			},
			{
				onSuccess: () => setSaved(true),
				onError: (err) =>
					setSaveError(err.message || "Failed to save investigation policy"),
			},
		);
	}

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Auto-Investigation Trigger</CardTitle>
				</CardHeader>
				<CardContent>
					<RadioGroup
						value={trigger}
						onValueChange={(v) => setTrigger(v as TriggerPolicy)}
						className="space-y-3"
					>
						{TRIGGER_OPTIONS.map((option) => (
							<div key={option.value} className="flex items-center space-x-2">
								<RadioGroupItem
									value={option.value}
									id={`trigger-${option.value}`}
								/>
								<Label htmlFor={`trigger-${option.value}`}>
									{option.label}
								</Label>
							</div>
						))}
					</RadioGroup>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Analysis Context</CardTitle>
				</CardHeader>
				<CardContent>
					<Label htmlFor="investigation-context">
						Additional context for AI agents investigating incidents on this
						service
					</Label>
					<Textarea
						id="investigation-context"
						className="mt-2"
						rows={4}
						placeholder="e.g. This service handles payment processing and is PCI-DSS compliant..."
						value={context}
						onChange={(e) => setContext(e.target.value)}
					/>
				</CardContent>
			</Card>

			<div className="flex items-center gap-3">
				<Button onClick={handleSave} disabled={updateService.isPending}>
					{updateService.isPending ? "Saving..." : "Save"}
				</Button>
				{saved && (
					<span className="text-sm text-run-done">Saved successfully</span>
				)}
				{saveError && (
					<span className="text-sm text-destructive">{saveError}</span>
				)}
			</div>
		</div>
	);
}
