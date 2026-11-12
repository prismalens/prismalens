// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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
import { buttonVariants } from "@/components/ui/button";

/** The second confirmation a dangerous setting asks for (#1101 cat 18); the row already states the risk. */
export function RiskConfirm({
	open,
	onOpenChange,
	title,
	risk,
	confirmLabel,
	onConfirm,
	testId,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	risk: string;
	confirmLabel: string;
	onConfirm: () => void;
	testId?: string;
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent data-testid={testId}>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{risk}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel data-testid={testId && `${testId}-cancel`}>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction
						className={buttonVariants({ variant: "danger-fill" })}
						onClick={onConfirm}
						data-testid={testId && `${testId}-ok`}
					>
						{confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
