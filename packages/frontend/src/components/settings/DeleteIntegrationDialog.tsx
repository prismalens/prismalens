// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
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
		<DestructiveConfirm
			open={open}
			onOpenChange={onOpenChange}
			title="Delete integration?"
			description={
				<p>
					This permanently deletes the <strong>{integrationLabel}</strong>{" "}
					integration and everything connected through it.
				</p>
			}
			confirmLabel="Delete"
			onConfirm={onDelete}
			onCancel={onCancel}
			isPending={isDeleting}
			isLoading={isLoading}
			error={error}
		>
			{isLoading ? (
				<div className="space-y-2 py-2">
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-4 w-3/4" />
					<Skeleton className="h-4 w-1/2" />
				</div>
			) : impact ? (
				<DeletionImpactSection impact={impact} showConnections />
			) : null}
		</DestructiveConfirm>
	);
}
