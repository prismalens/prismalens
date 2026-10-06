// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Git Repository Selector Component
 *
 * Provider-agnostic component for selecting organizations and repositories
 * from a git provider connection (GitHub, GitLab, BitBucket).
 */

import type { GitOrganization, GitRepository } from "@prismalens/contracts";
import { Globe, Loader2, Lock, Search, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Pool, Row } from "@/components/shared/Row";
import { Segmented } from "@/components/shared/Segmented";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Empty, Loading } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

/** Radix reserves the empty value for "nothing chosen"; every org needs its own. */
const ALL_ORGS = "__all";

export interface GitRepoSelectorProps {
	connectionId: string;
	providerName: string;
	providerDisplayName: string;
	organizations: GitOrganization[];
	repositories: GitRepository[];
	isLoadingOrgs: boolean;
	isLoadingRepos: boolean;
	selectedOrg?: string;
	onOrgChange: (org: string | undefined) => void;
	// Initial config from existing connection
	initialConfig?: {
		organization?: string;
		repositories?: string[];
		allRepositories?: boolean;
		defaultBranch?: string;
	};
	onSave: (config: {
		organization?: string;
		repositories: string[];
		allRepositories: boolean;
		defaultBranch: string;
	}) => void;
	onCancel: () => void;
	isSaving: boolean;
}

export function GitRepoSelector({
	providerDisplayName,
	organizations,
	repositories,
	isLoadingOrgs,
	isLoadingRepos,
	selectedOrg,
	onOrgChange,
	initialConfig,
	onSave,
	onCancel,
	isSaving,
}: GitRepoSelectorProps) {
	// Repository selection mode
	const [repoMode, setRepoMode] = useState<"all" | "specific">(
		initialConfig?.allRepositories === false ? "specific" : "all",
	);

	// Selected repositories (for specific mode)
	const [selectedRepos, setSelectedRepos] = useState<Set<string>>(
		new Set(initialConfig?.repositories ?? []),
	);

	// Default branch
	const [defaultBranch, setDefaultBranch] = useState(
		initialConfig?.defaultBranch ?? "main",
	);

	// Search filter for repositories
	const [repoSearch, setRepoSearch] = useState("");

	// Filtered repositories
	const filteredRepos = useMemo(() => {
		if (!repoSearch) return repositories;
		const search = repoSearch.toLowerCase();
		return repositories.filter(
			(repo) =>
				repo.name.toLowerCase().includes(search) ||
				repo.description?.toLowerCase().includes(search) ||
				repo.language?.toLowerCase().includes(search),
		);
	}, [repositories, repoSearch]);

	// Toggle repository selection
	const toggleRepo = (repoFullName: string) => {
		const newSelected = new Set(selectedRepos);
		if (newSelected.has(repoFullName)) {
			newSelected.delete(repoFullName);
		} else {
			newSelected.add(repoFullName);
		}
		setSelectedRepos(newSelected);
	};

	// Select/deselect all visible repos
	const toggleAllVisible = () => {
		const allVisible = filteredRepos.map((r) => r.fullName);
		const allSelected = allVisible.every((r) => selectedRepos.has(r));

		if (allSelected) {
			// Deselect all visible
			const newSelected = new Set(selectedRepos);
			for (const r of allVisible) newSelected.delete(r);
			setSelectedRepos(newSelected);
		} else {
			// Select all visible
			const newSelected = new Set(selectedRepos);
			for (const r of allVisible) newSelected.add(r);
			setSelectedRepos(newSelected);
		}
	};

	const handleSave = () => {
		onSave({
			organization: selectedOrg,
			repositories: repoMode === "specific" ? Array.from(selectedRepos) : [],
			allRepositories: repoMode === "all",
			defaultBranch,
		});
	};

	const canSave =
		repoMode === "all" || (repoMode === "specific" && selectedRepos.size > 0);

	return (
		<div>
			<SettingGroup title="Organization">
				{isLoadingOrgs ? (
					<Loading rows={1} />
				) : organizations.length === 0 ? (
					<Empty
						text={`No organizations found. Grant organization access in ${providerDisplayName}.`}
					/>
				) : (
					<Pool>
						<SettingRow
							label="Read repositories from"
							description="All the repositories this connection can reach, or one organization's"
						>
							<Select
								value={selectedOrg ?? ALL_ORGS}
								onValueChange={(v) =>
									onOrgChange(v === ALL_ORGS ? undefined : v)
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="All accessible" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL_ORGS}>All accessible</SelectItem>
									{organizations.map((org) => (
										<SelectItem key={org.id} value={org.name}>
											<span className="flex items-center gap-2">
												{org.avatarUrl && (
													<img
														src={org.avatarUrl}
														alt=""
														className="size-4 rounded-[3px]"
													/>
												)}
												<span>{org.displayName}</span>
												{org.repoCount !== undefined && (
													<span className="text-text-3">{org.repoCount}</span>
												)}
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SettingRow>
					</Pool>
				)}
			</SettingGroup>

			<SettingGroup
				title="Repositories"
				count={isLoadingRepos ? undefined : repositories.length}
				className="mt-8"
			>
				<Segmented
					label="Which repositories"
					value={repoMode}
					onChange={setRepoMode}
					options={[
						{ value: "all", label: "All" },
						{ value: "specific", label: "Chosen ones" },
					]}
					className="mb-3"
				/>
				{repoMode === "specific" && (
					<>
						<div className="mb-2 flex items-center gap-2">
							<div className="relative min-w-0 flex-1">
								<Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-3" />
								<Input
									aria-label="Search repositories"
									placeholder="Search"
									value={repoSearch}
									onChange={(e) => setRepoSearch(e.target.value)}
									className="pl-8"
								/>
							</div>
							<span className="text-meta text-text-3 tabular-nums">
								{selectedRepos.size} chosen
							</span>
							<Button
								variant="text"
								size="sm"
								onClick={toggleAllVisible}
								disabled={filteredRepos.length === 0}
							>
								{filteredRepos.every((r) => selectedRepos.has(r.fullName))
									? "Clear these"
									: "Choose these"}
							</Button>
						</div>
						{isLoadingRepos ? (
							<Loading rows={5} />
						) : filteredRepos.length === 0 ? (
							<Empty
								text={
									repoSearch
										? "No repository matches."
										: "No repositories found."
								}
							/>
						) : (
							<Pool className="max-h-80 overflow-y-auto">
								{filteredRepos.map((repo) => (
									<Row
										key={repo.id}
										className="relative"
										lead={
											<Checkbox
												checked={selectedRepos.has(repo.fullName)}
												onCheckedChange={() => toggleRepo(repo.fullName)}
												aria-label={repo.name}
											/>
										}
										label={
											<span className="flex min-w-0 items-center gap-2">
												<span className="truncate">{repo.name}</span>
												{repo.isPrivate ? (
													<Lock className="size-3 shrink-0 text-text-3" />
												) : (
													<Globe className="size-3 shrink-0 text-text-3" />
												)}
											</span>
										}
										meta={repo.description || "\u00a0"}
										trailing={
											<span className="flex items-center gap-3 text-meta text-text-3">
												{repo.language}
												{repo.stars !== undefined && (
													<span className="flex items-center gap-1 tabular-nums">
														<Star className="size-3" />
														{repo.stars}
													</span>
												)}
											</span>
										}
									/>
								))}
							</Pool>
						)}
					</>
				)}
			</SettingGroup>

			<SettingGroup title="Default branch" className="mt-8">
				<Pool>
					<SettingRow
						label="Branch"
						description="Read when an alert does not name one"
					>
						<Select value={defaultBranch} onValueChange={setDefaultBranch}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="main">main</SelectItem>
								<SelectItem value="master">master</SelectItem>
								<SelectItem value="develop">develop</SelectItem>
							</SelectContent>
						</Select>
					</SettingRow>
				</Pool>
			</SettingGroup>

			<div className="mt-6 flex justify-end gap-2">
				<Button variant="text" onClick={onCancel} disabled={isSaving}>
					Cancel
				</Button>
				<Button
					variant="primary"
					onClick={handleSave}
					disabled={!canSave || isSaving}
				>
					{isSaving && (
						<Loader2 className="size-3.5 motion-safe:animate-spin" />
					)}
					Save
				</Button>
			</div>
		</div>
	);
}
