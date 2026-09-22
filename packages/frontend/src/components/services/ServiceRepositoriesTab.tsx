// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { ServiceWithRelations } from "@prismalens/contracts";
import { FolderGit2, GitBranch, Loader2, Plus, Unlink } from "lucide-react";
import { useState } from "react";
import { Mono } from "@/components/shared/Mono";
import { MutationError } from "@/components/shared/MutationError";
import { StateChip } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	useLinkRepository,
	useRepositories,
	useUnlinkRepository,
} from "@/lib/api/hooks";

interface ServiceRepositoriesTabProps {
	serviceId: string;
	service: ServiceWithRelations;
}

export function ServiceRepositoriesTab({
	serviceId,
	service,
}: ServiceRepositoriesTabProps) {
	const [showInlinePicker, setShowInlinePicker] = useState(false);
	const [selectedRepoId, setSelectedRepoId] = useState<string>("");
	const [subPath, setSubPath] = useState("");
	const [isPrimary, setIsPrimary] = useState(false);
	const [linkError, setLinkError] = useState<string | null>(null);

	const repos = service.repositories ?? [];
	const unlinkRepo = useUnlinkRepository();
	const linkRepo = useLinkRepository();
	const linkedRepoIds = repos.map((sr) => sr.repositoryId);

	const { data: repoResponse } = useRepositories({
		limit: 100,
	});

	const availableRepos = (repoResponse?.data ?? []).filter(
		(r) => !linkedRepoIds.includes(r.id),
	);

	const handleLink = async () => {
		if (!selectedRepoId) return;
		setLinkError(null);
		try {
			await linkRepo.mutateAsync({
				id: selectedRepoId,
				serviceId,
				subPath: subPath.trim() || undefined,
				isPrimary,
			});
			setShowInlinePicker(false);
			setSelectedRepoId("");
			setSubPath("");
			setIsPrimary(false);
		} catch (err) {
			setLinkError(
				err instanceof Error ? err.message : "Failed to link repository",
			);
		}
	};

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium">
					Linked Repositories ({repos.length})
				</h3>
				{!showInlinePicker && (
					<Button
						size="sm"
						variant="outline"
						onClick={() => setShowInlinePicker(true)}
					>
						<Plus className="h-4 w-4 mr-1" />
						Link Repository
					</Button>
				)}
			</div>

			{showInlinePicker && (
				<div className="p-3 border rounded-lg bg-muted/40 space-y-3">
					<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						Link repository
					</p>
					<div className="flex flex-wrap items-center gap-2">
						<Select value={selectedRepoId} onValueChange={setSelectedRepoId}>
							<SelectTrigger className="w-64 h-8 text-xs">
								<SelectValue placeholder="Select a repository..." />
							</SelectTrigger>
							<SelectContent>
								{availableRepos.map((r) => (
									<SelectItem key={r.id} value={r.id}>
										{r.fullName}
									</SelectItem>
								))}
							</SelectContent>
						</Select>

						<Input
							placeholder="Sub-path (optional)"
							value={subPath}
							onChange={(e) => setSubPath(e.target.value)}
							className="w-44 h-8 text-xs font-mono"
						/>

						<div className="flex items-center gap-1.5 px-2">
							<Checkbox
								id="inline-is-primary"
								checked={isPrimary}
								onCheckedChange={(c) => setIsPrimary(c === true)}
							/>
							<Label
								htmlFor="inline-is-primary"
								className="text-xs font-normal"
							>
								Primary
							</Label>
						</div>

						<div className="flex items-center gap-1 ml-auto">
							<Button
								variant="ghost"
								size="sm"
								className="h-8 text-xs"
								onClick={() => {
									setShowInlinePicker(false);
									setSelectedRepoId("");
									setSubPath("");
									setIsPrimary(false);
									setLinkError(null);
								}}
								disabled={linkRepo.isPending}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								className="h-8 text-xs"
								onClick={handleLink}
								disabled={!selectedRepoId || linkRepo.isPending}
							>
								{linkRepo.isPending && (
									<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
								)}
								Link
							</Button>
						</div>
					</div>
					{linkError && <p className="text-xs text-destructive">{linkError}</p>}
				</div>
			)}

			<MutationError error={unlinkRepo.error} className="mb-4" />

			<div className="rounded-md border">
				{repos.length > 0 ? (
					<div className="divide-y">
						{repos.map((sr) => (
							<div
								key={sr.id}
								className="flex items-center justify-between p-4 hover:bg-muted/50"
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<FolderGit2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
										<Mono className="font-medium text-sm truncate">
											{sr.repository.fullName}
										</Mono>
										{sr.isPrimary && <StateChip tone="done">primary</StateChip>}
									</div>
									<div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
										{sr.repository.language && (
											<span>{sr.repository.language}</span>
										)}
										{sr.repository.defaultBranch && (
											<span className="flex items-center gap-1">
												<GitBranch className="h-3 w-3" />
												<Mono>{sr.repository.defaultBranch}</Mono>
											</span>
										)}
										{sr.subPath && <Mono>/{sr.subPath}</Mono>}
									</div>
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="text-destructive hover:text-destructive"
									disabled={unlinkRepo.isPending}
									onClick={() =>
										unlinkRepo.mutate({
											id: sr.repositoryId,
											serviceId,
										})
									}
								>
									<Unlink className="h-4 w-4 mr-1" />
									Unlink
								</Button>
							</div>
						))}
					</div>
				) : (
					<p className="p-4 text-sm text-muted-foreground text-center">
						No repositories linked to this service
					</p>
				)}
			</div>
		</div>
	);
}
