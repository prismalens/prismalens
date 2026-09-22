// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import {
	enumOptions,
	SERVICE_TIER_METADATA,
	SERVICE_TYPE_LABEL,
	type ServiceTier,
	type ServiceType,
	ServiceTypeSchema,
	type ServiceWithRelations,
} from "@prismalens/contracts";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { TagInput } from "@/components/shared/TagInput";
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
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	useAddRepositorySource,
	useCreateService,
	useUpdateService,
} from "@/lib/api/hooks";

export interface ServiceFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Pass existing service for edit mode, null/undefined for create mode */
	service?: ServiceWithRelations | null;
	onSuccess?: () => void;
}

const SERVICE_TYPES = enumOptions(ServiceTypeSchema, SERVICE_TYPE_LABEL);

const SERVICE_TIERS: { value: ServiceTier; label: string }[] = Object.entries(
	SERVICE_TIER_METADATA,
).map(([value, meta]) => ({
	value: value as ServiceTier,
	label: meta.shortName,
}));

export function ServiceFormDialog({
	open,
	onOpenChange,
	service,
	onSuccess,
}: ServiceFormDialogProps) {
	const isEditing = !!service;

	// Form state
	const [name, setName] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [description, setDescription] = useState("");
	const [type, setType] = useState<ServiceType>("service");
	const [tier, setTier] = useState<ServiceTier>("tier_3");
	const [team, setTeam] = useState("");
	const [tags, setTags] = useState<string[]>([]);
	const [repository, setRepository] = useState("");
	const [error, setError] = useState<string | null>(null);
	// Set once create succeeds, so a retry after a repository error updates instead of creating twice.
	const [createdId, setCreatedId] = useState<string | null>(null);

	// Mutations
	const createService = useCreateService();
	const updateService = useUpdateService();
	const addSource = useAddRepositorySource();
	const isPending =
		createService.isPending || updateService.isPending || addSource.isPending;
	const primaryRepo = service?.repositories?.find((r) => r.isPrimary);
	const currentRepository = !primaryRepo
		? ""
		: primaryRepo.repository.sourceKind === "folder" && primaryRepo.subPath
			? `${primaryRepo.repository.url}/${primaryRepo.subPath}`
			: primaryRepo.repository.url;

	// Populate form when editing or reset for create
	useEffect(() => {
		if (open) {
			if (service) {
				setName(service.name);
				setDisplayName(service.displayName || "");
				setDescription(service.description || "");
				setType(service.type);
				setTier(service.tier);
				setTeam(service.team || "");
				setTags(service.tags || []);
				setRepository(currentRepository);
			} else {
				// Reset form for create
				setName("");
				setDisplayName("");
				setDescription("");
				setType("service");
				setTier("tier_3");
				setTeam("");
				setTags([]);
				setRepository("");
			}
			setError(null);
			setCreatedId(null);
		}
	}, [service, open, currentRepository]);

	const handleSubmit = async () => {
		if (!name.trim()) {
			setError("Name is required");
			return;
		}

		setError(null);

		try {
			let serviceId = service?.id ?? createdId ?? undefined;
			if (serviceId) {
				await updateService.mutateAsync({
					id: serviceId,
					displayName: displayName || undefined,
					description: description || undefined,
					type,
					tier,
					team: team || undefined,
					tags: tags.length > 0 ? tags : undefined,
				});
			} else {
				const created = await createService.mutateAsync({
					name: name.trim(),
					displayName: displayName || undefined,
					description: description || undefined,
					type,
					tier,
					team: team || undefined,
					tags: tags.length > 0 ? tags : undefined,
				});
				serviceId = created.id;
				setCreatedId(created.id);
			}
			const source = repository.trim();
			if (serviceId && source && source !== currentRepository) {
				const repo = await addSource.mutateAsync({ serviceId, source });
				if (repo.syncError) {
					// The service and link are saved; keep the dialog open so git's answer is read.
					setError(`Saved, but git could not read it: ${repo.syncError}`);
					return;
				}
			}
			onOpenChange(false);
			onSuccess?.();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to save service";
			setError(message);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{isEditing ? "Edit Service" : "Add Service"}
					</DialogTitle>
					<DialogDescription>
						{isEditing
							? "Update the service configuration."
							: "Add a new service to the catalog."}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{/* Name - required */}
					<div className="space-y-2">
						<Label htmlFor="name">
							Name <span className="text-destructive">*</span>
						</Label>
						<Input
							id="name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="payment-service"
							disabled={isEditing} // Name should not change after creation
						/>
						<p className="text-xs text-muted-foreground">
							Unique identifier, typically kebab-case
						</p>
					</div>

					{/* Display Name */}
					<div className="space-y-2">
						<Label htmlFor="displayName">Display Name</Label>
						<Input
							id="displayName"
							value={displayName}
							onChange={(e) => setDisplayName(e.target.value)}
							placeholder="Payment Service"
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="repository">Repository</Label>
						<Input
							id="repository"
							value={repository}
							onChange={(e) => setRepository(e.target.value)}
							placeholder="~/code/payment-service or git@github.com:acme/payments.git"
							data-testid="service-repository-input"
						/>
						<p className="text-xs text-muted-foreground">
							A folder on this machine or a git URL. Each investigation reads a
							fresh copy of its last commit; uncommitted changes are not
							included.
						</p>
					</div>

					{/* Description */}
					<div className="space-y-2">
						<Label htmlFor="description">Description</Label>
						<Textarea
							id="description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Handles payment processing..."
							rows={2}
						/>
					</div>

					{/* Type and Tier row */}
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label>Type</Label>
							<Select
								value={type}
								onValueChange={(v) => setType(v as ServiceType)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{SERVICE_TYPES.map((t) => (
										<SelectItem key={t.value} value={t.value}>
											{t.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<Label>Tier</Label>
							<Select
								value={tier}
								onValueChange={(v) => setTier(v as ServiceTier)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{SERVICE_TIERS.map((t) => (
										<SelectItem key={t.value} value={t.value}>
											{t.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					{/* Team */}
					<div className="space-y-2">
						<Label htmlFor="team">Team</Label>
						<Input
							id="team"
							value={team}
							onChange={(e) => setTeam(e.target.value)}
							placeholder="platform-team"
						/>
					</div>

					{/* Tags */}
					<div className="space-y-2">
						<Label>Tags</Label>
						<TagInput
							tags={tags}
							onChange={setTags}
							placeholder="Add tags (press Enter)"
						/>
					</div>

					{/* Error message */}
					{error && (
						<p className="text-sm text-destructive text-center">{error}</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={isPending || !name.trim()}>
						{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						{isEditing ? "Save Changes" : "Create Service"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
