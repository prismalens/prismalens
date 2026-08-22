// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";

export interface RuleEnabledToggleProps {
	ruleId: string;
	ruleName: string;
	enabled: boolean;
	disabled: boolean;
	onToggle: (enabled: boolean) => void;
}

/**
 * The checked state is whatever the last refetch returned — never a local
 * optimistic flag, so a rejected write cannot leave the row lying (#294).
 */
export function RuleEnabledToggle({
	ruleId,
	ruleName,
	enabled,
	disabled,
	onToggle,
}: RuleEnabledToggleProps) {
	return (
		<Checkbox
			id={`rule-enabled-${ruleId}`}
			aria-label={`Enabled — ${ruleName}`}
			checked={enabled}
			disabled={disabled}
			onCheckedChange={(checked) => onToggle(checked === true)}
		/>
	);
}

export interface DeleteRuleDialogProps {
	ruleName: string | null;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}

export function DeleteRuleDialog({
	ruleName,
	onOpenChange,
	onConfirm,
}: DeleteRuleDialogProps) {
	return (
		<AlertDialog open={!!ruleName} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete rule?</AlertDialogTitle>
					<AlertDialogDescription>
						{ruleName
							? `"${ruleName}" will be permanently deleted. Alerts will stop being evaluated against it.`
							: null}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={onConfirm}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
