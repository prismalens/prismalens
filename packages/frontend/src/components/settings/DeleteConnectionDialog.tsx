"use client";

import { Loader2 } from "lucide-react";

import { useConnectionDeletionImpact } from "@/lib/api/hooks";
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
import { DeletionImpactSection } from "./DeletionImpactSection";

interface DeleteConnectionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	connectionId: string | null;
	error: Error | null;
	onDelete: () => void;
	onCancel: () => void;
	isDeleting: boolean;
}

export function DeleteConnectionDialog({
	open,
	onOpenChange,
	connectionId,
	error,
	onDelete,
	onCancel,
	isDeleting,
}: DeleteConnectionDialogProps) {
	const { data: impact, isLoading } = useConnectionDeletionImpact(
		open ? connectionId : null,
	);

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete Connection?</AlertDialogTitle>
					<AlertDialogDescription>
						This will remove this connection. The integration itself
						will remain.
					</AlertDialogDescription>
				</AlertDialogHeader>

				{isLoading ? (
					<div className="space-y-2 py-2">
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-3/4" />
					</div>
				) : impact ? (
					<DeletionImpactSection
						impact={impact}
						showConnections={false}
					/>
				) : null}

				<MutationError error={error} />
				<AlertDialogFooter>
					<AlertDialogCancel onClick={onCancel}>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={onDelete}
						className="bg-destructive hover:bg-destructive/90"
						disabled={isDeleting || isLoading}
					>
						{isDeleting && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
