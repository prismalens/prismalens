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
import { Field } from "@/components/settings/Field";
import { TagInput } from "@/components/shared/TagInput";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
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
import { Textarea } from "@/components/ui/textarea";
import {
	useAddRepositorySource,
	useCreateService,
	useUpdateService,
} from "@/lib/api/hooks";
import { tierWord } from "./service-detail.utils";

export interface ServiceFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Pass existing service for edit mode, null/undefined for create mode */
	service?: ServiceWithRelations | null;
	onSuccess?: () => void;
}

const SERVICE_TYPES = enumOptions(ServiceTypeSchema, SERVICE_TYPE_LABEL);

/** "Tier 1", the word the services list and the band use. */
const SERVICE_TIERS: { value: ServiceTier; label: string }[] = Object.keys(
	SERVICE_TIER_METADATA,
).map((value) => ({ value: value as ServiceTier, label: tierWord(value) }));

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
			setError("A service needs a name.");
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
					setError(`Saved, but git could not read the code: ${repo.syncError}`);
					return;
				}
			}
			onOpenChange(false);
			onSuccess?.();
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "The service was not saved.";
			setError(message);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="service-form-dialog">
				<DialogHeader>
					<DialogTitle>
						{isEditing ? `Edit ${service.name}` : "Add a service"}
					</DialogTitle>
				</DialogHeader>

				<div className="space-y-4">
					<div className="grid grid-cols-2 gap-3">
						<Field label="Name" htmlFor="name">
							<Input
								id="name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="payments-api"
								disabled={isEditing}
							/>
						</Field>
						<Field label="Display name" htmlFor="displayName">
							<Input
								id="displayName"
								value={displayName}
								onChange={(e) => setDisplayName(e.target.value)}
								placeholder="Payments API"
							/>
						</Field>
					</div>

					<Field
						label="Code"
						htmlFor="repository"
						hint="A folder on this machine or a git URL; a run reads its last commit"
					>
						<Input
							id="repository"
							value={repository}
							onChange={(e) => setRepository(e.target.value)}
							placeholder="~/code/payments-api"
							data-testid="service-repository-input"
						/>
					</Field>

					<Field label="Description" htmlFor="description">
						<Textarea
							id="description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Takes card payments for checkout"
							rows={2}
							className="min-h-14 resize-none"
						/>
					</Field>

					<div className="grid grid-cols-2 gap-3">
						<Field label="Kind" htmlFor="service-kind">
							<Select
								value={type}
								onValueChange={(v) => setType(v as ServiceType)}
							>
								<SelectTrigger id="service-kind" className="w-full">
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
						</Field>
						<Field label="Tier" htmlFor="service-tier">
							<Select
								value={tier}
								onValueChange={(v) => setTier(v as ServiceTier)}
							>
								<SelectTrigger id="service-tier" className="w-full">
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
						</Field>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<Field label="Team" htmlFor="service-team">
							<Input
								id="service-team"
								value={team}
								onChange={(e) => setTeam(e.target.value)}
								placeholder="Payments"
							/>
						</Field>
						<Field label="Tags">
							<TagInput tags={tags} onChange={setTags} />
						</Field>
					</div>
				</div>

				<DialogFooter className="items-center">
					<div className="mr-auto min-h-5 min-w-0 flex-1">
						{error && (
							<p role="alert" className="text-meta text-danger">
								{error}
							</p>
						)}
					</div>
					<Button variant="text" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant="primary"
						onClick={handleSubmit}
						disabled={isPending || !name.trim()}
					>
						{isPending && (
							<Loader2 className="size-3.5 motion-safe:animate-spin" />
						)}
						{isEditing ? "Save" : "Create service"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
