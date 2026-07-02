"use client";

import { Loader2 } from "lucide-react";
import { MutationError } from "@/components/shared/MutationError";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useIntegrationDeletionImpact } from "@/lib/api/hooks";
import { DeletionImpactSection } from "./DeletionImpactSection";

interface DeleteIntegrationDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	integrationId: string | null;
	integrationLabel: string | undefined;
	error: Error | null;
	onDelete: () => void;
	onCancel: () => void;
	isDeleting: boolean;
}

export function DeleteIntegrationDialog({
	open,
	onOpenChange,
	integrationId,
	integrationLabel,
	error,
	onDelete,
	onCancel,
	isDeleting,
}: DeleteIntegrationDialogProps) {
	const { data: impact, isLoading } = useIntegrationDeletionImpact(
		open ? integrationId : null,
	);

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete Integration?</AlertDialogTitle>
					<AlertDialogDescription>
						This will permanently delete the <strong>{integrationLabel}</strong>{" "}
						integration and all associated data.
					</AlertDialogDescription>
				</AlertDialogHeader>

				{isLoading ? (
					<div className="space-y-2 py-2">
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-3/4" />
						<Skeleton className="h-4 w-1/2" />
					</div>
				) : impact ? (
					<DeletionImpactSection impact={impact} showConnections />
				) : null}

				<MutationError error={error} />
				<AlertDialogFooter>
					<AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={onDelete}
						className="bg-destructive hover:bg-destructive/90"
						disabled={isDeleting || isLoading}
					>
						{isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
