/**
 * Service List Component
 *
 * Displays services in a grid of cards
 */

import type { ServiceWithRelations } from "@prismalens/contracts";
import { Server } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { ServiceCard } from "./ServiceCard";

export interface ServiceListProps {
	services: ServiceWithRelations[];
	isLoading?: boolean;
}

export function ServiceList({ services, isLoading }: ServiceListProps) {
	if (isLoading) {
		return <ServiceListSkeleton />;
	}

	if (services.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
				<Server className="h-12 w-12 mb-4 opacity-50" />
				<p className="text-lg font-medium">No services found</p>
				<p className="text-sm">Services will appear here when added to the catalog</p>
			</div>
		);
	}

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{services.map((service) => (
				<ServiceCard key={service.id} service={service} />
			))}
		</div>
	);
}

function ServiceListSkeleton() {
	const skeletonIds = ["skel-1", "skel-2", "skel-3", "skel-4", "skel-5", "skel-6"];

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{skeletonIds.map((id) => (
				<div key={id} className="rounded-lg border p-4 space-y-3">
					<div className="flex items-start justify-between">
						<div className="flex items-center gap-3">
							<Skeleton className="h-10 w-10 rounded-lg" />
							<div className="space-y-1">
								<Skeleton className="h-5 w-32" />
								<Skeleton className="h-4 w-24" />
							</div>
						</div>
						<div className="flex flex-col items-end gap-1">
							<Skeleton className="h-5 w-16" />
							<Skeleton className="h-5 w-14" />
						</div>
					</div>
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-4 w-3/4" />
					<div className="flex items-center gap-2">
						<Skeleton className="h-5 w-16" />
						<Skeleton className="h-5 w-16" />
					</div>
				</div>
			))}
		</div>
	);
}
