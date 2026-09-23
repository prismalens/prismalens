// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Skeleton } from "@/components/ui/skeleton";
import { useConnectionDeletionImpact } from "@/lib/api/hooks";
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
		<DestructiveConfirm
			open={open}
			onOpenChange={onOpenChange}
			title="Delete connection?"
			description={<p>This removes the connection. The integration stays.</p>}
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
				</div>
			) : impact ? (
				<DeletionImpactSection impact={impact} showConnections={false} />
			) : null}
		</DestructiveConfirm>
	);
}
