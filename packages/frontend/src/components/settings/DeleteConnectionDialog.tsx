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

interface DeleteConnectionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	error: Error | null;
	onDelete: () => void;
	onCancel: () => void;
	isDeleting: boolean;
}

export function DeleteConnectionDialog({
	open,
	onOpenChange,
	error,
	onDelete,
	onCancel,
	isDeleting,
}: DeleteConnectionDialogProps) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete Connection?</AlertDialogTitle>
					<AlertDialogDescription>
						This will remove this connection. Any services
						using it will no longer have access to its data.
						The integration itself will remain.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<MutationError error={error} />
				<AlertDialogFooter>
					<AlertDialogCancel onClick={onCancel}>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={onDelete}
						className="bg-destructive hover:bg-destructive/90"
						disabled={isDeleting}
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
