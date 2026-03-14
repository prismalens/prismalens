import { CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function IncidentListSkeleton() {
	return (
		<div className="divide-y divide-border">
			{[1, 2, 3, 4].map((i) => (
				<div key={i} className="px-4 py-3">
					<div className="flex items-center gap-2 mb-2">
						<Skeleton className="h-5 w-16" />
						<Skeleton className="h-4 w-20" />
					</div>
					<Skeleton className="h-4 w-3/4 mb-1" />
					<Skeleton className="h-3 w-1/2" />
				</div>
			))}
		</div>
	);
}

export function IncidentDetailSkeleton() {
	return (
		<>
			<CardHeader className="pb-2">
				<div className="flex items-center gap-2 mb-2">
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-5 w-16" />
					<Skeleton className="h-5 w-20" />
				</div>
				<Skeleton className="h-6 w-3/4" />
				<Skeleton className="h-4 w-1/2 mt-2" />
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					<Skeleton className="h-10 w-full" />
					<div className="grid grid-cols-2 gap-4">
						<Skeleton className="h-20 w-full" />
						<Skeleton className="h-20 w-full" />
					</div>
				</div>
			</CardContent>
		</>
	);
}
