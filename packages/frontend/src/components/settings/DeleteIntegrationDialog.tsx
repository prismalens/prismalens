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

interface DeleteIntegrationDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	integrationLabel: string | undefined;
	connectionCount: number;
	error: Error | null;
	onDelete: () => void;
	onCancel: () => void;
	isDeleting: boolean;
}

export function DeleteIntegrationDialog({
	open,
	onOpenChange,
	integrationLabel,
	connectionCount,
	error,
	onDelete,
	onCancel,
	isDeleting,
}: DeleteIntegrationDialogProps) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete Integration?</AlertDialogTitle>
					<AlertDialogDescription>
						This will remove the{" "}
						<strong>{integrationLabel}</strong> integration
						{connectionCount > 0 && (
							<>
								{" "}
								and its{" "}
								<strong>
									{connectionCount} connection
									{connectionCount > 1 ? "s" : ""}
								</strong>
							</>
						)}
						. Any services using this integration will lose access.
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
