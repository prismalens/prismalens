import { useState, useMemo, useEffect, useCallback } from "react";
import { Loader2, Search } from "lucide-react";

import type { ServiceType } from "@prismalens/contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { useServices, useAddServiceDependency } from "@/lib/api/hooks";

interface AddDependencyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	serviceId: string;
	existingDependencyIds: string[];
	onSuccess?: () => void;
}

export function AddDependencyDialog({
	open,
	onOpenChange,
	serviceId,
	existingDependencyIds,
	onSuccess,
}: AddDependencyDialogProps) {
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [dependencyType, setDependencyType] = useState<string>("runtime");
	const [criticality, setCriticality] = useState<string>("required");
	const [error, setError] = useState<string | null>(null);

	const addDependency = useAddServiceDependency();

	// Debounce search input
	useEffect(() => {
		const timer = setTimeout(() => setDebouncedSearch(search), 300);
		return () => clearTimeout(timer);
	}, [search]);

	const { data: servicesResponse, isLoading } = useServices({
		search: debouncedSearch || undefined,
		limit: 20,
	});

	const excludedIds = useMemo(
		() => new Set([serviceId, ...existingDependencyIds]),
		[serviceId, existingDependencyIds],
	);

	const filteredServices = useMemo(() => {
		const services = servicesResponse?.data ?? [];
		return services.filter((s) => !excludedIds.has(s.id));
	}, [servicesResponse, excludedIds]);

	const selectedService = useMemo(
		() => filteredServices.find((s) => s.id === selectedId),
		[filteredServices, selectedId],
	);

	const handleClose = useCallback(() => {
		setSearch("");
		setDebouncedSearch("");
		setSelectedId(null);
		setDependencyType("runtime");
		setCriticality("required");
		setError(null);
		onOpenChange(false);
	}, [onOpenChange]);

	const handleSubmit = async () => {
		if (!selectedId) return;
		setError(null);

		try {
			await addDependency.mutateAsync({
				id: serviceId,
				dependencyId: selectedId,
				dependencyType: dependencyType as "runtime" | "build" | "data",
				criticality: criticality as "required" | "optional" | "degraded",
			});
			handleClose();
			onSuccess?.();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to add dependency";
			setError(message);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Add Dependency</DialogTitle>
					<DialogDescription>
						Search for a service to add as a dependency.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					{/* Search input */}
					<div className="relative">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search services..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="pl-9"
						/>
					</div>

					{/* Service list */}
					<div className="max-h-64 overflow-y-auto border rounded-md">
						{isLoading ? (
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
							</div>
						) : filteredServices.length === 0 ? (
							<p className="text-sm text-muted-foreground text-center py-8">
								{debouncedSearch
									? "No matching services found"
									: "No available services"}
							</p>
						) : (
							<div className="p-1 space-y-0.5">
								{filteredServices.map((service) => (
									<button
										key={service.id}
										type="button"
										className={cn(
											"w-full flex items-center justify-between gap-2 p-2 rounded text-left text-sm hover:bg-muted/50 transition-colors",
											selectedId === service.id &&
												"bg-muted border border-border",
										)}
										onClick={() => setSelectedId(service.id)}
									>
										<div className="min-w-0">
											<p className="font-medium truncate">
												{service.displayName || service.name}
											</p>
											{service.description && (
												<p className="text-xs text-muted-foreground truncate">
													{service.description}
												</p>
											)}
										</div>
										<Badge variant="outline" className="shrink-0 text-xs">
											{service.type as ServiceType}
										</Badge>
									</button>
								))}
							</div>
						)}
					</div>

					{/* Dependency type */}
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<label className="text-sm font-medium">Type</label>
							<Select
								value={dependencyType}
								onValueChange={setDependencyType}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="runtime">Runtime</SelectItem>
									<SelectItem value="build">Build</SelectItem>
									<SelectItem value="data">Data</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-1.5">
							<label className="text-sm font-medium">Criticality</label>
							<Select value={criticality} onValueChange={setCriticality}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="required">Required</SelectItem>
									<SelectItem value="optional">Optional</SelectItem>
									<SelectItem value="degraded">Degraded</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					{error && (
						<p className="text-sm text-destructive">{error}</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={handleClose}>
						Cancel
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={!selectedId || addDependency.isPending}
					>
						{addDependency.isPending && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Add Dependency
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
