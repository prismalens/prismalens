import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";

import type { ServiceTier, ServiceType } from "@prismalens/contracts";

import { orpc } from "@/lib/api/orpc-client";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ServiceFormDialog } from "@/components/services/ServiceFormDialog";
import { ServiceList } from "@/components/services/ServiceList";

export const Route = createFileRoute("/_authenticated/services/")({
	component: ServicesPage,
});

const serviceTypes: { value: ServiceType | "all"; label: string }[] = [
	{ value: "all", label: "All Types" },
	{ value: "service", label: "Service" },
	{ value: "database", label: "Database" },
	{ value: "queue", label: "Queue" },
	{ value: "cache", label: "Cache" },
	{ value: "gateway", label: "Gateway" },
	{ value: "external", label: "External" },
	{ value: "infrastructure", label: "Infrastructure" },
];

const serviceTiers: { value: ServiceTier | "all"; label: string }[] = [
	{ value: "all", label: "All Tiers" },
	{ value: "tier_1", label: "Tier 1 - Critical" },
	{ value: "tier_2", label: "Tier 2 - High" },
	{ value: "tier_3", label: "Tier 3 - Medium" },
	{ value: "tier_4", label: "Tier 4 - Low" },
];

function ServicesPage() {
	const [typeFilter, setTypeFilter] = useState<ServiceType | "all">("all");
	const [tierFilter, setTierFilter] = useState<ServiceTier | "all">("all");
	const [showAddDialog, setShowAddDialog] = useState(false);

	// Fetch services
	const {
		data: services = [],
		isLoading,
		refetch,
		isRefetching,
	} = useQuery(orpc.services.list.queryOptions({ input: { limit: 100 } }));

	// Apply client-side filtering
	const filteredServices = services.filter((service) => {
		if (typeFilter !== "all" && service.type !== typeFilter) return false;
		if (tierFilter !== "all" && service.tier !== tierFilter) return false;
		return true;
	})

	const handleClearFilters = () => {
		setTypeFilter("all");
		setTierFilter("all");
	}

	const hasFilters = typeFilter !== "all" || tierFilter !== "all";

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">Services</h1>
					<p className="text-muted-foreground">
						{services.length} services in catalog
						{hasFilters && ` (${filteredServices.length} shown)`}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => refetch()}
						disabled={isRefetching}
					>
						<RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
						Refresh
					</Button>
					<Button size="sm" onClick={() => setShowAddDialog(true)}>
						<Plus className="h-4 w-4 mr-2" />
						Add Service
					</Button>
				</div>
			</div>

			{/* Stats Summary */}
			{!isLoading && services.length > 0 && (
				<div className="flex items-center gap-6 text-sm">
					<div>
						<span className="text-muted-foreground">Tier 1 (Critical):</span>{" "}
						<span className="font-medium">{services.filter((s) => s.tier === "tier_1").length}</span>
					</div>
					<div>
						<span className="text-muted-foreground">Tier 2 (High):</span>{" "}
						<span className="font-medium">{services.filter((s) => s.tier === "tier_2").length}</span>
					</div>
					<div>
						<span className="text-muted-foreground">Tier 3 (Medium):</span>{" "}
						<span className="font-medium">{services.filter((s) => s.tier === "tier_3").length}</span>
					</div>
					<div>
						<span className="text-muted-foreground">Tier 4 (Low):</span>{" "}
						<span className="font-medium">{services.filter((s) => s.tier === "tier_4").length}</span>
					</div>
				</div>
			)}

			{/* Filters */}
			<div className="flex flex-wrap items-center gap-3">
				<Select
					value={typeFilter}
					onValueChange={(value) => setTypeFilter(value as ServiceType | "all")}
				>
					<SelectTrigger className="w-[160px]">
						<SelectValue placeholder="Filter by type" />
					</SelectTrigger>
					<SelectContent>
						{serviceTypes.map((type) => (
							<SelectItem key={type.value} value={type.value}>
								{type.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select
					value={tierFilter}
					onValueChange={(value) => setTierFilter(value as ServiceTier | "all")}
				>
					<SelectTrigger className="w-[180px]">
						<SelectValue placeholder="Filter by tier" />
					</SelectTrigger>
					<SelectContent>
						{serviceTiers.map((tier) => (
							<SelectItem key={tier.value} value={tier.value}>
								{tier.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{hasFilters && (
					<Button variant="ghost" size="sm" onClick={handleClearFilters}>
						Clear filters
					</Button>
				)}
			</div>

			{/* Service List */}
			<ServiceList services={filteredServices} isLoading={isLoading} />

			{/* Add Service Dialog */}
			<ServiceFormDialog
				open={showAddDialog}
				onOpenChange={setShowAddDialog}
				onSuccess={() => refetch()}
			/>
		</div>
	)
}

