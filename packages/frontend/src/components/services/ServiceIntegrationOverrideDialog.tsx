"use client";

/**
 * Service Integration Override Dialog
 *
 * Dialog for creating or editing service-specific integration overrides.
 * Supports different config UI based on integration type (GitHub, Prometheus, etc.)
 */

import { useState, useEffect, useMemo } from "react";
import {
	Check,
	Github,
	Globe,
	Link2,
	Loader2,
	Lock,
	MessageSquare,
	Search,
	Star,
	Zap,
} from "lucide-react";
import type {
	GitOrganization,
	GitRepository,
	ServiceIntegrationWithStatus,
} from "@prismalens/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

export interface ServiceIntegrationOverrideDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	serviceId: string;
	serviceName: string;
	// For editing existing override
	overrideId?: string;
	integration?: ServiceIntegrationWithStatus;
	// Connection data for new overrides
	connectionId?: string;
	// Git provider data (for GitHub, GitLab, BitBucket)
	organizations?: GitOrganization[];
	repositories?: GitRepository[];
	isLoadingOrgs?: boolean;
	isLoadingRepos?: boolean;
	selectedOrg?: string;
	onOrgChange?: (org: string | undefined) => void;
	// Save handler
	onSave: (config: Record<string, unknown>) => void;
	isSaving: boolean;
}

// Integration icon helper
function getIntegrationIcon(definitionName: string) {
	switch (definitionName) {
		case "github":
			return <Github className="h-5 w-5" />;
		case "slack":
			return <MessageSquare className="h-5 w-5" />;
		case "prometheus":
			return <Zap className="h-5 w-5" />;
		default:
			return <Link2 className="h-5 w-5" />;
	}
}

export function ServiceIntegrationOverrideDialog({
	open,
	onOpenChange,
	serviceName,
	overrideId,
	integration,
	organizations = [],
	repositories = [],
	isLoadingOrgs = false,
	isLoadingRepos = false,
	selectedOrg,
	onOrgChange,
	onSave,
	isSaving,
}: ServiceIntegrationOverrideDialogProps) {
	const isEditing = !!overrideId;
	const definitionName = integration?.definitionName || "unknown";

	// Initialize config from existing override or global config
	const initialConfig = useMemo(() => {
		if (integration?.serviceConfig) {
			return integration.serviceConfig;
		}
		if (integration?.globalConfig) {
			return integration.globalConfig;
		}
		return {};
	}, [integration]);

	// Git config state
	const [repoMode, setRepoMode] = useState<"all" | "specific">("all");
	const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
	const [repoSearch, setRepoSearch] = useState("");

	// Prometheus config state
	const [labels, setLabels] = useState<Record<string, string>>({});
	const [newLabelKey, setNewLabelKey] = useState("");
	const [newLabelValue, setNewLabelValue] = useState("");

	// Initialize state from existing config
	useEffect(() => {
		if (definitionName === "github") {
			const config = initialConfig as {
				allRepositories?: boolean;
				repositories?: string[];
			};
			setRepoMode(config.allRepositories === false ? "specific" : "all");
			setSelectedRepos(new Set(config.repositories || []));
		} else if (definitionName === "prometheus") {
			const config = initialConfig as {
				labels?: Record<string, string>;
			};
			setLabels(config.labels || {});
		}
	}, [definitionName, initialConfig]);

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

	// Add Prometheus label
	const addLabel = () => {
		if (newLabelKey && newLabelValue) {
			setLabels({ ...labels, [newLabelKey]: newLabelValue });
			setNewLabelKey("");
			setNewLabelValue("");
		}
	};

	// Remove Prometheus label
	const removeLabel = (key: string) => {
		const newLabels = { ...labels };
		delete newLabels[key];
		setLabels(newLabels);
	};

	// Build config and save
	const handleSave = () => {
		let config: Record<string, unknown> = {};

		switch (definitionName) {
			case "github":
				config = {
					organization: selectedOrg,
					allRepositories: repoMode === "all",
					repositories: repoMode === "specific" ? Array.from(selectedRepos) : [],
				};
				break;
			case "prometheus":
				config = {
					labels,
				};
				break;
			default:
				// For unknown integrations, just pass through
				config = initialConfig;
		}

		onSave(config);
	};

	// Validation
	const canSave = useMemo(() => {
		switch (definitionName) {
			case "github":
				return repoMode === "all" || selectedRepos.size > 0;
			case "prometheus":
				return true; // Labels are optional
			default:
				return true;
		}
	}, [definitionName, repoMode, selectedRepos]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{getIntegrationIcon(definitionName)}
						{isEditing ? "Edit" : "Create"} Override for {serviceName}
					</DialogTitle>
					<DialogDescription>
						{integration?.definitionDisplayName} - {integration?.connectionName}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 py-4">
					{/* GitHub Config */}
					{definitionName === "github" && (
						<GitHubConfigEditor
							organizations={organizations}
							repositories={filteredRepos}
							isLoadingOrgs={isLoadingOrgs}
							isLoadingRepos={isLoadingRepos}
							selectedOrg={selectedOrg}
							onOrgChange={onOrgChange}
							repoMode={repoMode}
							onRepoModeChange={setRepoMode}
							selectedRepos={selectedRepos}
							onToggleRepo={toggleRepo}
							repoSearch={repoSearch}
							onRepoSearchChange={setRepoSearch}
						/>
					)}

					{/* Prometheus Config */}
					{definitionName === "prometheus" && (
						<PrometheusConfigEditor
							labels={labels}
							onAddLabel={addLabel}
							onRemoveLabel={removeLabel}
							newLabelKey={newLabelKey}
							onNewLabelKeyChange={setNewLabelKey}
							newLabelValue={newLabelValue}
							onNewLabelValueChange={setNewLabelValue}
						/>
					)}

					{/* Unknown Integration */}
					{!["github", "prometheus"].includes(definitionName) && (
						<div className="text-center py-6 text-muted-foreground">
							<p>Configuration not available for this integration type.</p>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={isSaving}
					>
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
								{isEditing ? "Update" : "Create"} Override
							</>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// GitHub config editor component
interface GitHubConfigEditorProps {
	organizations: GitOrganization[];
	repositories: GitRepository[];
	isLoadingOrgs: boolean;
	isLoadingRepos: boolean;
	selectedOrg?: string;
	onOrgChange?: (org: string | undefined) => void;
	repoMode: "all" | "specific";
	onRepoModeChange: (mode: "all" | "specific") => void;
	selectedRepos: Set<string>;
	onToggleRepo: (repoFullName: string) => void;
	repoSearch: string;
	onRepoSearchChange: (search: string) => void;
}

function GitHubConfigEditor({
	organizations,
	repositories,
	isLoadingOrgs,
	isLoadingRepos,
	selectedOrg,
	onOrgChange,
	repoMode,
	onRepoModeChange,
	selectedRepos,
	onToggleRepo,
	repoSearch,
	onRepoSearchChange,
}: GitHubConfigEditorProps) {
	return (
		<div className="space-y-4">
			{/* Organization selector */}
			<div className="space-y-2">
				<Label>Organization</Label>
				{isLoadingOrgs ? (
					<Skeleton className="h-10 w-full" />
				) : (
					<Select
						value={selectedOrg ?? ""}
						onValueChange={(v) => onOrgChange?.(v || undefined)}
					>
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
									</div>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
			</div>

			{/* Repository access mode */}
			<div className="space-y-2">
				<Label>Repository Access</Label>
				<RadioGroup
					value={repoMode}
					onValueChange={(v: string) => onRepoModeChange(v as "all" | "specific")}
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
			</div>

			{/* Repository list (for specific mode) */}
			{repoMode === "specific" && (
				<div className="space-y-3">
					{/* Search */}
					<div className="relative">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search repositories..."
							value={repoSearch}
							onChange={(e) => onRepoSearchChange(e.target.value)}
							className="pl-9"
						/>
					</div>

					{/* Selected count */}
					<div className="text-sm text-muted-foreground">
						{selectedRepos.size} selected
					</div>

					{/* Repository list */}
					{isLoadingRepos ? (
						<div className="space-y-2">
							{Array.from({ length: 5 }, (_, i) => (
								<Skeleton key={`skeleton-${i}`} className="h-12 w-full" />
							))}
						</div>
					) : repositories.length === 0 ? (
						<p className="text-sm text-muted-foreground text-center py-4">
							{repoSearch
								? "No repositories match your search"
								: "No repositories found"}
						</p>
					) : (
						<div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-2">
							{repositories.map((repo) => (
								<button
									key={repo.id}
									type="button"
									className={cn(
										"flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer w-full text-left",
										selectedRepos.has(repo.fullName) && "bg-muted",
									)}
									onClick={() => onToggleRepo(repo.fullName)}
								>
									<Checkbox
										checked={selectedRepos.has(repo.fullName)}
										onCheckedChange={() => onToggleRepo(repo.fullName)}
									/>
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span className="font-medium truncate">{repo.name}</span>
											{repo.isPrivate ? (
												<Lock className="h-3 w-3 text-muted-foreground" />
											) : (
												<Globe className="h-3 w-3 text-muted-foreground" />
											)}
										</div>
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
								</button>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// Prometheus config editor component
interface PrometheusConfigEditorProps {
	labels: Record<string, string>;
	onAddLabel: () => void;
	onRemoveLabel: (key: string) => void;
	newLabelKey: string;
	onNewLabelKeyChange: (key: string) => void;
	newLabelValue: string;
	onNewLabelValueChange: (value: string) => void;
}

function PrometheusConfigEditor({
	labels,
	onAddLabel,
	onRemoveLabel,
	newLabelKey,
	onNewLabelKeyChange,
	newLabelValue,
	onNewLabelValueChange,
}: PrometheusConfigEditorProps) {
	return (
		<div className="space-y-4">
			<div>
				<Label>Label Filters</Label>
				<p className="text-sm text-muted-foreground mt-1">
					Only include metrics with these Prometheus labels for this service.
				</p>
			</div>

			{/* Existing labels */}
			{Object.keys(labels).length > 0 && (
				<div className="space-y-2">
					{Object.entries(labels).map(([key, value]) => (
						<div
							key={key}
							className="flex items-center gap-2 p-2 bg-muted rounded"
						>
							<code className="text-sm flex-1">
								{key}="{value}"
							</code>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => onRemoveLabel(key)}
							>
								Remove
							</Button>
						</div>
					))}
				</div>
			)}

			{/* Add new label */}
			<div className="flex gap-2">
				<Input
					placeholder="Label key (e.g., job)"
					value={newLabelKey}
					onChange={(e) => onNewLabelKeyChange(e.target.value)}
					className="flex-1"
				/>
				<Input
					placeholder="Value (e.g., api-gateway)"
					value={newLabelValue}
					onChange={(e) => onNewLabelValueChange(e.target.value)}
					className="flex-1"
				/>
				<Button
					variant="outline"
					onClick={onAddLabel}
					disabled={!newLabelKey || !newLabelValue}
				>
					Add
				</Button>
			</div>

			{Object.keys(labels).length === 0 && (
				<p className="text-sm text-muted-foreground text-center py-2">
					No label filters configured. All metrics will be included.
				</p>
			)}
		</div>
	);
}
