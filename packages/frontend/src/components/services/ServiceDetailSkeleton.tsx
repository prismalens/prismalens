import { Skeleton } from "@/components/ui/skeleton";

export function ServiceDetailSkeleton() {
	return (
		<div className="space-y-6">
			<Skeleton className="h-4 w-32" />
			<div className="flex items-start gap-3">
				<Skeleton className="h-10 w-10 rounded-lg" />
				<div className="space-y-2">
					<Skeleton className="h-8 w-64" />
					<Skeleton className="h-4 w-32" />
				</div>
			</div>
			<div className="flex gap-8">
				<Skeleton className="h-64 w-48" />
				<Skeleton className="h-64 flex-1" />
			</div>
		</div>
	);
}
