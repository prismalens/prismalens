import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw, Server } from "lucide-react";

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
				<div className="flex items-center gap-3">
					<Server className="h-8 w-8 text-primary" />
					<div>
						<h1 className="text-2xl font-bold">Services</h1>
						<p className="text-muted-foreground">
							{services.length} services in catalog
							{hasFilters && ` (${filteredServices.length} shown)`}
						</p>
					</div>
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

			{/* Stats Cards */}
			{!isLoading && services.length > 0 && (
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
					<StatCard
						label="Tier 1 (Critical)"
						value={services.filter((s) => s.tier === "tier_1").length}
						className="bg-red-500/10 text-red-600"
					/>
					<StatCard
						label="Tier 2 (High)"
						value={services.filter((s) => s.tier === "tier_2").length}
						className="bg-orange-500/10 text-orange-600"
					/>
					<StatCard
						label="Tier 3 (Medium)"
						value={services.filter((s) => s.tier === "tier_3").length}
						className="bg-yellow-500/10 text-yellow-600"
					/>
					<StatCard
						label="Tier 4 (Low)"
						value={services.filter((s) => s.tier === "tier_4").length}
						className="bg-gray-500/10 text-gray-600"
					/>
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

function StatCard({
	label,
	value,
	className,
}: {
	label: string;
	value: number;
	className?: string;
}) {
	return (
		<div className={`rounded-lg p-4 ${className}`}>
			<div className="text-2xl font-bold">{value}</div>
			<div className="text-sm text-muted-foreground">{label}</div>
		</div>
	)
}
