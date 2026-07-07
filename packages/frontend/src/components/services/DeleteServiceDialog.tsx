// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
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
import { useDeleteService } from "@/lib/api/hooks";

export interface DeleteServiceDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	serviceId: string;
	serviceName: string;
	onSuccess?: () => void;
}

export function DeleteServiceDialog({
	open,
	onOpenChange,
	serviceId,
	serviceName,
	onSuccess,
}: DeleteServiceDialogProps) {
	const [error, setError] = useState<string | null>(null);
	const deleteService = useDeleteService();

	const handleDelete = async () => {
		setError(null);
		try {
			await deleteService.mutateAsync({ id: serviceId });
			onOpenChange(false);
			onSuccess?.();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to delete service";
			setError(message);
		}
	};

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete Service?</AlertDialogTitle>
					<AlertDialogDescription>
						This will permanently delete <strong>{serviceName}</strong> from the
						service catalog. This action cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				{error && (
					<p className="text-sm text-destructive text-center">{error}</p>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={handleDelete}
						className="bg-destructive hover:bg-destructive/90"
						disabled={deleteService.isPending}
					>
						{deleteService.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
