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

/**
 * Reopen a Resolved incident, behind a confirm (R1a d4, d7). It goes back to
 * Acknowledged in Needs you; its cause stays as Previous cause. With
 * `investigate`, the board's drop on Working, a run starts after.
 */
export function ReopenDialog({
	open,
	onOpenChange,
	incidentNumber,
	investigate = false,
	isPending,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	incidentNumber: number;
	investigate?: boolean;
	isPending?: boolean;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent data-testid="reopen-dialog">
				<AlertDialogHeader>
					<AlertDialogTitle>
						{investigate
							? `Reopen INC-${incidentNumber} and investigate?`
							: `Reopen INC-${incidentNumber}?`}
					</AlertDialogTitle>
					<AlertDialogDescription>
						Its cause stays as Previous cause until you resolve it again.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						disabled={isPending}
						onClick={onConfirm}
						data-testid="confirm-reopen-incident"
					>
						{investigate ? "Reopen and investigate" : "Reopen"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
