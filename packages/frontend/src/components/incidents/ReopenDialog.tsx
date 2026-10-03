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
 * Reopen a resolved or closed incident, behind a confirm (#743, walk u18).
 * It goes back to Investigating; no run starts.
 */
export function ReopenDialog({
	open,
	onOpenChange,
	incidentNumber,
	isPending,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	incidentNumber: number;
	isPending?: boolean;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent data-testid="reopen-dialog">
				<AlertDialogHeader>
					<AlertDialogTitle>Reopen INC-{incidentNumber}?</AlertDialogTitle>
					<AlertDialogDescription>
						It goes back to Investigating and its resolve time is cleared.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						disabled={isPending}
						onClick={onConfirm}
						data-testid="confirm-reopen-incident"
					>
						Reopen
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
