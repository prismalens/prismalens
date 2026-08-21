// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { TestCorrelationResponse } from "@prismalens/contracts";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTestCorrelation } from "@/lib/api/hooks";
import { CORRELATION_ALERT_SAMPLE, parseMatchCriteria } from "./rule-samples";

export interface TestCorrelationDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function TestCorrelationDialog({
	open,
	onOpenChange,
}: TestCorrelationDialogProps) {
	const [alertData, setAlertData] = useState(CORRELATION_ALERT_SAMPLE);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<TestCorrelationResponse | null>(null);

	const testCorrelation = useTestCorrelation();

	useEffect(() => {
		if (open) {
			setAlertData(CORRELATION_ALERT_SAMPLE);
			setError(null);
			setResult(null);
		}
	}, [open]);

	const handleAlertDataChange = (value: string) => {
		setAlertData(value);
		setResult(null);
	};

	const handleSubmit = async () => {
		const parsed = parseMatchCriteria(alertData);
		if (!parsed.ok) {
			setError("Sample alert must be a JSON object");
			setResult(null);
			return;
		}

		setError(null);

		try {
			const response = await testCorrelation.mutateAsync({
				alertData: parsed.value,
			});
			setResult(response);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to evaluate sample alert";
			setError(message);
			setResult(null);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Test with a sample alert</DialogTitle>
					<DialogDescription>
						Evaluates this sample alert against your saved, enabled correlation
						rules. It does not test unsaved edits — save a rule first, then test
						it.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="correlation-test-alert">Sample alert</Label>
						<Textarea
							id="correlation-test-alert"
							className="font-mono text-xs"
							value={alertData}
							onChange={(e) => handleAlertDataChange(e.target.value)}
							rows={8}
						/>
					</div>

					{result && (
						<div
							className="rounded-md border border-border bg-muted/50 p-3 space-y-2"
							data-testid="correlation-test-result"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="text-sm font-medium">
									{result.matchedRule
										? result.matchedRule.name
										: "No rule matched"}
								</span>
								<Badge variant="secondary">{result.action}</Badge>
							</div>
							<p className="text-sm text-muted-foreground">{result.reason}</p>
						</div>
					)}

					{error && (
						<p className="text-sm text-destructive text-center">{error}</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Close
					</Button>
					<Button onClick={handleSubmit} disabled={testCorrelation.isPending}>
						{testCorrelation.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Run test
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
