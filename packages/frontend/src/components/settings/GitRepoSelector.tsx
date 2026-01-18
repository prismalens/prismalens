/**
 * Git Repository Selector Component
 *
 * Provider-agnostic component for selecting organizations and repositories
 * from a git provider connection (GitHub, GitLab, BitBucket).
 */

import { useState, useMemo } from "react";
import {
	Building2,
	Check,
	ChevronDown,
	GitBranch,
	Globe,
	Loader2,
	Lock,
	Search,
	Star,
} from "lucide-react";
import type { GitOrganization, GitRepository } from "@prismalens/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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
		<div className="space-y-6">
			{/* Organization selector */}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base flex items-center gap-2">
						<Building2 className="h-4 w-4" />
						Organization
					</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoadingOrgs ? (
						<Skeleton className="h-10 w-full" />
					) : organizations.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No organizations found. You may need to grant organization access
							in {providerDisplayName}.
						</p>
					) : (
						<Select value={selectedOrg ?? ""} onValueChange={onOrgChange}>
							<SelectTrigger>
								<SelectValue placeholder="Select an organization" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="">
									<span className="text-muted-foreground">
										All accessible repositories
									</span>
								</SelectItem>
								{organizations.map((org) => (
									<SelectItem key={org.id} value={org.name}>
										<div className="flex items-center gap-2">
											{org.avatarUrl && (
												<img
													src={org.avatarUrl}
													alt={org.displayName}
													className="h-4 w-4 rounded"
												/>
											)}
											<span>{org.displayName}</span>
											{org.repoCount !== undefined && (
												<span className="text-xs text-muted-foreground">
													({org.repoCount} repos)
												</span>
											)}
										</div>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
				</CardContent>
			</Card>

			{/* Repository access mode */}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base flex items-center gap-2">
						<GitBranch className="h-4 w-4" />
						Repository Access
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<RadioGroup
						value={repoMode}
						onValueChange={(v: string) => setRepoMode(v as "all" | "specific")}
					>
						<div className="flex items-center space-x-2">
							<RadioGroupItem value="all" id="all" />
							<Label htmlFor="all" className="flex items-center gap-2">
								All repositories
								{!isLoadingRepos && (
									<span className="text-xs text-muted-foreground">
										({repositories.length} available)
									</span>
								)}
							</Label>
						</div>
						<div className="flex items-center space-x-2">
							<RadioGroupItem value="specific" id="specific" />
							<Label htmlFor="specific">Select specific repositories</Label>
						</div>
					</RadioGroup>

					{/* Repository list (for specific mode) */}
					<Collapsible open={repoMode === "specific"}>
						<CollapsibleContent className="space-y-3">
							{/* Search */}
							<div className="relative">
								<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									placeholder="Search repositories..."
									value={repoSearch}
									onChange={(e) => setRepoSearch(e.target.value)}
									className="pl-9"
								/>
							</div>

							{/* Select all button */}
							<div className="flex items-center justify-between">
								<span className="text-sm text-muted-foreground">
									{selectedRepos.size} selected
								</span>
								<Button
									variant="ghost"
									size="sm"
									onClick={toggleAllVisible}
									disabled={filteredRepos.length === 0}
								>
									{filteredRepos.every((r) => selectedRepos.has(r.fullName))
										? "Deselect all"
										: "Select all"}
								</Button>
							</div>

							{/* Repository list */}
							{isLoadingRepos ? (
								<div className="space-y-2">
									{[...Array(5)].map((_, i) => (
										<Skeleton key={i} className="h-12 w-full" />
									))}
								</div>
							) : filteredRepos.length === 0 ? (
								<p className="text-sm text-muted-foreground text-center py-4">
									{repoSearch
										? "No repositories match your search"
										: "No repositories found"}
								</p>
							) : (
								<div className="max-h-64 overflow-y-auto space-y-1 border rounded-md p-2">
									{filteredRepos.map((repo) => (
										<div
											key={repo.id}
											className={cn(
												"flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer",
												selectedRepos.has(repo.fullName) && "bg-muted",
											)}
											onClick={() => toggleRepo(repo.fullName)}
										>
											<Checkbox
												checked={selectedRepos.has(repo.fullName)}
												onCheckedChange={() => toggleRepo(repo.fullName)}
											/>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<span className="font-medium truncate">
														{repo.name}
													</span>
													{repo.isPrivate ? (
														<Lock className="h-3 w-3 text-muted-foreground" />
													) : (
														<Globe className="h-3 w-3 text-muted-foreground" />
													)}
												</div>
												{repo.description && (
													<p className="text-xs text-muted-foreground truncate">
														{repo.description}
													</p>
												)}
											</div>
											<div className="flex items-center gap-3 text-xs text-muted-foreground">
												{repo.language && (
													<Badge variant="outline" className="text-xs">
														{repo.language}
													</Badge>
												)}
												{repo.stars !== undefined && (
													<span className="flex items-center gap-1">
														<Star className="h-3 w-3" />
														{repo.stars}
													</span>
												)}
											</div>
										</div>
									))}
								</div>
							)}
						</CollapsibleContent>
					</Collapsible>
				</CardContent>
			</Card>

			{/* Default branch */}
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="text-base flex items-center gap-2">
						<GitBranch className="h-4 w-4" />
						Default Branch
					</CardTitle>
				</CardHeader>
				<CardContent>
					<Select value={defaultBranch} onValueChange={setDefaultBranch}>
						<SelectTrigger className="w-48">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="main">main</SelectItem>
							<SelectItem value="master">master</SelectItem>
							<SelectItem value="develop">develop</SelectItem>
						</SelectContent>
					</Select>
					<p className="text-xs text-muted-foreground mt-2">
						Branch used for code analysis when no specific branch is specified.
					</p>
				</CardContent>
			</Card>

			{/* Actions */}
			<div className="flex justify-end gap-3">
				<Button variant="outline" onClick={onCancel} disabled={isSaving}>
					Cancel
				</Button>
				<Button onClick={handleSave} disabled={!canSave || isSaving}>
					{isSaving ? (
						<>
							<Loader2 className="h-4 w-4 mr-2 animate-spin" />
							Saving...
						</>
					) : (
						<>
							<Check className="h-4 w-4 mr-2" />
							Save Configuration
						</>
					)}
				</Button>
			</div>
		</div>
	);
}
