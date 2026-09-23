// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { useState } from "react";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
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
			setError(err instanceof Error ? err.message : "Failed to delete service");
		}
	};

	return (
		<DestructiveConfirm
			open={open}
			onOpenChange={onOpenChange}
			title="Delete service?"
			description={
				<p>
					This removes <strong>{serviceName}</strong> from the catalog.
					Incidents that named it keep their record.
				</p>
			}
			confirmLabel="Delete"
			onConfirm={handleDelete}
			isPending={deleteService.isPending}
			error={error}
		/>
	);
}
