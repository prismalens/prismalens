// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Mono } from "@/components/shared/Mono";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	useAddServiceDependency,
	useServices,
	useUpdateServiceDependency,
} from "@/lib/api/hooks";

export interface DependencyEditorProps {
	mode: "add" | "edit";
	serviceId: string;
	dependency?: {
		dependencyId: string;
		name: string;
		type: string;
		criticality: string;
	} | null;
	existingDependencyIds?: string[];
	onSuccess?: () => void;
	onCancel: () => void;
}

export function DependencyEditor({
	mode,
	serviceId,
	dependency,
	existingDependencyIds = [],
	onSuccess,
	onCancel,
}: DependencyEditorProps) {
	const [selectedServiceId, setSelectedServiceId] = useState<string>(
		dependency?.dependencyId ?? "",
	);
	const [dependencyType, setDependencyType] = useState<string>(
		dependency?.type ?? "runtime",
	);
	const [criticality, setCriticality] = useState<string>(
		dependency?.criticality ?? "required",
	);
	const [error, setError] = useState<string | null>(null);

	const addDependency = useAddServiceDependency();
	const updateDependency = useUpdateServiceDependency();

	const { data: servicesResponse } = useServices({
		limit: 100,
	});

	const availableServices = (servicesResponse?.data ?? []).filter(
		(s) => s.id !== serviceId && !existingDependencyIds.includes(s.id),
	);

	useEffect(() => {
		if (dependency) {
			setSelectedServiceId(dependency.dependencyId);
			setDependencyType(dependency.type);
			setCriticality(dependency.criticality);
		} else {
			setSelectedServiceId("");
			setDependencyType("runtime");
			setCriticality("required");
		}
		setError(null);
	}, [dependency, mode]);

	const isPending = addDependency.isPending || updateDependency.isPending;

	const handleSave = async () => {
		setError(null);
		if (mode === "add") {
			if (!selectedServiceId) {
				setError("Select a service");
				return;
			}
			try {
				await addDependency.mutateAsync({
					id: serviceId,
					dependencyId: selectedServiceId,
					dependencyType: dependencyType as "runtime" | "build" | "data",
					criticality: criticality as "required" | "optional" | "degraded",
				});
				onSuccess?.();
			} catch (err) {
				setError(
					err instanceof Error ? err.message : "Failed to add dependency",
				);
			}
		} else if (mode === "edit" && dependency) {
			try {
				await updateDependency.mutateAsync({
					id: serviceId,
					dependencyId: dependency.dependencyId,
					dependencyType: dependencyType as "runtime" | "build" | "data",
					criticality: criticality as "required" | "optional" | "degraded",
				});
				onSuccess?.();
			} catch (err) {
				setError(
					err instanceof Error ? err.message : "Failed to update dependency",
				);
			}
		}
	};

	return (
		<div className="p-3 mb-3 border rounded-lg bg-muted/40 space-y-3">
			<div className="flex items-center justify-between">
				<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					{mode === "add" ? "Add dependency" : "Edit dependency"}
				</p>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				{mode === "add" ? (
					<Select
						value={selectedServiceId}
						onValueChange={setSelectedServiceId}
					>
						<SelectTrigger className="w-56 h-8 text-xs">
							<SelectValue placeholder="Select target service..." />
						</SelectTrigger>
						<SelectContent>
							{availableServices.map((svc) => (
								<SelectItem key={svc.id} value={svc.id}>
									{svc.displayName || svc.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : (
					<div className="px-2 py-1 rounded bg-muted text-xs font-medium">
						<Mono>{dependency?.name}</Mono>
					</div>
				)}

				<Select value={dependencyType} onValueChange={setDependencyType}>
					<SelectTrigger className="w-32 h-8 text-xs">
						<SelectValue placeholder="Type" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="runtime">Runtime</SelectItem>
						<SelectItem value="build">Build</SelectItem>
						<SelectItem value="data">Data</SelectItem>
					</SelectContent>
				</Select>

				<Select value={criticality} onValueChange={setCriticality}>
					<SelectTrigger className="w-32 h-8 text-xs">
						<SelectValue placeholder="Criticality" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="required">Required</SelectItem>
						<SelectItem value="optional">Optional</SelectItem>
						<SelectItem value="degraded">Degraded</SelectItem>
					</SelectContent>
				</Select>

				<div className="flex items-center gap-1 ml-auto">
					<Button
						variant="ghost"
						size="sm"
						className="h-8 text-xs"
						onClick={onCancel}
						disabled={isPending}
					>
						Cancel
					</Button>
					<Button
						size="sm"
						className="h-8 text-xs"
						onClick={handleSave}
						disabled={isPending || (mode === "add" && !selectedServiceId)}
					>
						{isPending && (
							<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
						)}
						{mode === "add" ? "Add" : "Save"}
					</Button>
				</div>
			</div>

			{error && <p className="text-xs text-destructive">{error}</p>}
		</div>
	);
}
