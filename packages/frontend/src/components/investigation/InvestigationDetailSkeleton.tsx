// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Skeleton } from "@/components/ui/skeleton";

export function InvestigationDetailSkeleton() {
	return (
		<div className="space-y-6">
			<Skeleton className="h-4 w-32" />
			<div className="flex items-start justify-between">
				<div className="space-y-2">
					<Skeleton className="h-8 w-64" />
					<Skeleton className="h-4 w-48" />
					<Skeleton className="h-4 w-96" />
				</div>
				<div className="flex gap-2">
					<Skeleton className="h-9 w-24" />
					<Skeleton className="h-9 w-24" />
				</div>
			</div>
			<Skeleton className="h-10 w-64" />
			<Skeleton className="h-[500px]" />
		</div>
	);
}
