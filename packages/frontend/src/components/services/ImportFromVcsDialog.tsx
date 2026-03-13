import type { GitRepository, ServiceTier } from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
	AlertCircle,
	Check,
	ChevronRight,
	GitBranch,
	Globe,
	Loader2,
	Lock,
	Search,
	Star,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

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
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	useConnections,
	useCreateService,
	useGitOrganizations,
	useGitRepositories,
	useServices,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

// VCS template prefixes that indicate a git provider
const VCS_PREFIXES = ["github", "gitlab", "bitbucket"];

function isVcsTemplateId(templateId: string): boolean {
	return VCS_PREFIXES.some((prefix) => templateId.startsWith(prefix));
}

function getProviderName(templateId: string): string {
	for (const prefix of VCS_PREFIXES) {
		if (templateId.startsWith(prefix)) return prefix;
	}
	return templateId;
}

function toKebabCase(str: string): string {
	return str
		.replace(/[^a-zA-Z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.toLowerCase();
}

function toTitleCase(str: string): string {
	return str.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface ImportFromVcsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: () => void;
}

type Step = "connection" | "browse" | "review";

interface SelectedRepo {
	fullName: string;
	name: string;
	description?: string | null;
	language?: string | null;
	isPrivate?: boolean;
	url?: string;
}

export function ImportFromVcsDialog({
	open,
	onOpenChange,
	onSuccess,
}: ImportFromVcsDialogProps) {
	const navigate = useNavigate();

	// State
	const [step, setStep] = useState<Step>("connection");
	const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
	const [selectedOrg, setSelectedOrg] = useState<string | undefined>();
	const [selectedRepos, setSelectedRepos] = useState<Map<string, SelectedRepo>>(
		new Map(),
	);
	const [repoSearch, setRepoSearch] = useState("");
	const [bulkTier, setBulkTier] = useState<ServiceTier>("tier_3");
	const [importProgress, setImportProgress] = useState<{
		current: number;
		total: number;
		importing: boolean;
		results: Array<{ name: string; success: boolean; error?: string }>;
	} | null>(null);

	// Queries
	const { data: allConnections = [] } = useConnections();
	const { data: existingServicesResponse } = useServices();
	const existingServices = existingServicesResponse?.data ?? [];
	const createService = useCreateService();

	// Filter to VCS connections only
	const vcsConnections = useMemo(
		() =>
			allConnections.filter((c) =>
				isVcsTemplateId(c.integration?.templateId ?? ""),
			),
		[allConnections],
	);

	// Auto-select single connection
	const activeConnectionId =
		selectedConnectionId ||
		(vcsConnections.length === 1 ? vcsConnections[0].id : "");

	const activeConnection = vcsConnections.find(
		(c) => c.id === activeConnectionId,
	);
	const providerName = activeConnection
		? getProviderName(activeConnection.integration?.templateId ?? "")
		: "";

	// Git data queries (enabled when connection selected)
	const { data: organizations = [], isLoading: isLoadingOrgs } =
		useGitOrganizations(activeConnectionId);
	const { data: repositories = [], isLoading: isLoadingRepos } =
		useGitRepositories(activeConnectionId, selectedOrg);

	// Build set of already-imported repo URLs for duplicate detection
	const importedRepoUrls = useMemo(() => {
		const urls = new Set<string>();
		for (const service of existingServices) {
			if (service.repository) {
				urls.add(service.repository);
				// Also match by fullName pattern (org/repo)
				const match = service.repository.match(
					/(?:github|gitlab|bitbucket)\.(?:com|org)\/([^/]+\/[^/]+)/,
				);
				if (match) urls.add(match[1]);
			}
		}
		return urls;
	}, [existingServices]);

	const isRepoImported = useCallback(
		(repo: GitRepository) => {
			if (importedRepoUrls.has(repo.fullName)) return true;
			if (repo.url && importedRepoUrls.has(repo.url)) return true;
			return false;
		},
		[importedRepoUrls],
	);

	// Filtered repositories
	const filteredRepos = useMemo(() => {
		if (!repoSearch) return repositories;
		const search = repoSearch.toLowerCase();
		return repositories.filter(
			(repo) =>
				repo.name.toLowerCase().includes(search) ||
				repo.fullName.toLowerCase().includes(search) ||
				repo.description?.toLowerCase().includes(search) ||
				repo.language?.toLowerCase().includes(search),
		);
	}, [repositories, repoSearch]);

	// Handlers
	const toggleRepo = (repo: GitRepository) => {
		if (isRepoImported(repo)) return;
		const newSelected = new Map(selectedRepos);
		if (newSelected.has(repo.fullName)) {
			newSelected.delete(repo.fullName);
		} else {
			newSelected.set(repo.fullName, {
				fullName: repo.fullName,
				name: repo.name,
				description: repo.description,
				language: repo.language,
				isPrivate: repo.isPrivate,
				url: repo.url,
			});
		}
		setSelectedRepos(newSelected);
	};

	const toggleAllVisible = () => {
		const selectableRepos = filteredRepos.filter((r) => !isRepoImported(r));
		const allSelected = selectableRepos.every((r) =>
			selectedRepos.has(r.fullName),
		);

		const newSelected = new Map(selectedRepos);
		if (allSelected) {
			for (const r of selectableRepos) newSelected.delete(r.fullName);
		} else {
			for (const r of selectableRepos) {
				newSelected.set(r.fullName, {
					fullName: r.fullName,
					name: r.name,
					description: r.description,
					language: r.language,
					isPrivate: r.isPrivate,
					url: r.url,
				});
			}
		}
		setSelectedRepos(newSelected);
	};

	const handleGoToStep = (target: Step) => {
		if (target === "browse" && !activeConnectionId) return;
		setStep(target);
	};

	const handleImport = async () => {
		const repos = Array.from(selectedRepos.values());
		setImportProgress({
			current: 0,
			total: repos.length,
			importing: true,
			results: [],
		});

		const results: Array<{ name: string; success: boolean; error?: string }> =
			[];

		for (let i = 0; i < repos.length; i++) {
			const repo = repos[i];
			const serviceName = toKebabCase(repo.fullName.replace("/", "-"));

			try {
				await createService.mutateAsync({
					name: serviceName,
					displayName: toTitleCase(repo.name),
					description: repo.description ?? undefined,
					type: "service",
					tier: bulkTier,
					repository:
						repo.url ?? `https://${providerName}.com/${repo.fullName}`,
					discoverySource: providerName,
					discoveryMetadata: {
						repository: repo.fullName,
						importedAt: new Date().toISOString(),
						connectionId: activeConnectionId,
					},
					isDiscovered: true,
				});
				results.push({ name: serviceName, success: true });
			} catch (err) {
				const message = err instanceof Error ? err.message : "Unknown error";
				results.push({ name: serviceName, success: false, error: message });
			}

			setImportProgress({
				current: i + 1,
				total: repos.length,
				importing: i + 1 < repos.length,
				results: [...results],
			});
		}

		onSuccess?.();
	};

	const handleClose = () => {
		// Reset state
		setStep("connection");
		setSelectedConnectionId("");
		setSelectedOrg(undefined);
		setSelectedRepos(new Map());
		setRepoSearch("");
		setBulkTier("tier_3");
		setImportProgress(null);
		onOpenChange(false);
	};

	// =========================================================================
	// RENDER
	// =========================================================================

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<GitBranch className="h-5 w-5" />
						Import Services from VCS
					</DialogTitle>
					<DialogDescription>
						{step === "connection" &&
							"Select a VCS connection to import repositories from."}
						{step === "browse" &&
							"Browse and select repositories to import as services."}
						{step === "review" && "Review and import selected repositories."}
					</DialogDescription>
				</DialogHeader>

				{/* Step 1: Connection Selection */}
				{step === "connection" && (
					<div className="space-y-4">
						{vcsConnections.length === 0 ? (
							<div className="text-center py-8 space-y-3">
								<AlertCircle className="h-10 w-10 mx-auto text-muted-foreground" />
								<p className="text-sm text-muted-foreground">
									No VCS connections found. Set up a GitHub, GitLab, or
									Bitbucket integration first.
								</p>
								<Button
									variant="outline"
									onClick={() => {
										handleClose();
										navigate({
											to: "/settings",
											search: { tab: "integrations" },
										});
									}}
								>
									Go to Integrations
								</Button>
							</div>
						) : (
							<RadioGroup
								value={activeConnectionId}
								onValueChange={(id) => {
									setSelectedConnectionId(id);
									setSelectedOrg(undefined);
									setSelectedRepos(new Map());
								}}
								className="space-y-2"
							>
								{vcsConnections.map((conn) => (
									<label
										key={conn.id}
										htmlFor={`conn-${conn.id}`}
										className={cn(
											"flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50",
											activeConnectionId === conn.id &&
												"border-primary bg-muted/30",
										)}
									>
										<RadioGroupItem id={`conn-${conn.id}`} value={conn.id} />
										<GitBranch className="h-4 w-4 text-muted-foreground" />
										<div>
											<p className="font-medium text-sm">
												{conn.integration?.label ||
													conn.integration?.templateId}
											</p>
											<p className="text-xs text-muted-foreground">
												{getProviderName(conn.integration?.templateId ?? "")}
											</p>
										</div>
									</label>
								))}
							</RadioGroup>
						)}
					</div>
				)}

				{/* Step 2: Browse & Select Repos */}
				{step === "browse" && (
					<div className="space-y-4">
						{/* Org picker */}
						{organizations.length > 0 && (
							<Select
								value={selectedOrg ?? "__all__"}
								onValueChange={(v) =>
									setSelectedOrg(v === "__all__" ? undefined : v)
								}
							>
								<SelectTrigger>
									<SelectValue placeholder="All accessible repositories" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="__all__">
										All accessible repositories
									</SelectItem>
									{organizations.map((org) => (
										<SelectItem key={org.id} value={org.name}>
											{org.displayName}{" "}
											{org.repoCount !== undefined && `(${org.repoCount})`}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}

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

						{/* Select all / count */}
						<div className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground">
								{selectedRepos.size} selected
							</span>
							<Button
								variant="ghost"
								size="sm"
								onClick={toggleAllVisible}
								disabled={filteredRepos.length === 0}
							>
								{filteredRepos
									.filter((r) => !isRepoImported(r))
									.every((r) => selectedRepos.has(r.fullName))
									? "Deselect all"
									: "Select all"}
							</Button>
						</div>

						{/* Repo list */}
						{isLoadingRepos || isLoadingOrgs ? (
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
							</div>
						) : filteredRepos.length === 0 ? (
							<p className="text-sm text-muted-foreground text-center py-8">
								{repoSearch
									? "No repositories match your search"
									: "No repositories found"}
							</p>
						) : (
							<div className="max-h-72 overflow-y-auto space-y-1 border rounded-md p-2">
								{filteredRepos.map((repo) => {
									const imported = isRepoImported(repo);
									return (
										<label
											key={repo.id}
											htmlFor={`repo-${repo.id}`}
											className={cn(
												"flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer",
												selectedRepos.has(repo.fullName) && "bg-muted",
												imported && "opacity-50 cursor-not-allowed",
											)}
										>
											<Checkbox
												id={`repo-${repo.id}`}
												checked={selectedRepos.has(repo.fullName)}
												disabled={imported}
												onCheckedChange={() => toggleRepo(repo)}
											/>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<span className="font-medium text-sm truncate">
														{repo.name}
													</span>
													{repo.isPrivate ? (
														<Lock className="h-3 w-3 text-muted-foreground shrink-0" />
													) : (
														<Globe className="h-3 w-3 text-muted-foreground shrink-0" />
													)}
													{imported && (
														<Badge
															variant="secondary"
															className="text-xs shrink-0"
														>
															Already imported
														</Badge>
													)}
												</div>
												{repo.description && (
													<p className="text-xs text-muted-foreground truncate">
														{repo.description}
													</p>
												)}
											</div>
											<div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
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
										</label>
									);
								})}
							</div>
						)}
					</div>
				)}

				{/* Step 3: Review & Import */}
				{step === "review" && !importProgress && (
					<div className="space-y-4">
						{/* Bulk tier selection */}
						<div className="flex items-center gap-3">
							<span className="text-sm font-medium">Default tier:</span>
							<Select
								value={bulkTier}
								onValueChange={(v) => setBulkTier(v as ServiceTier)}
							>
								<SelectTrigger className="w-48">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="tier_1">Tier 1 - Critical</SelectItem>
									<SelectItem value="tier_2">Tier 2 - High</SelectItem>
									<SelectItem value="tier_3">Tier 3 - Medium</SelectItem>
									<SelectItem value="tier_4">Tier 4 - Low</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{/* Selected repos preview */}
						<div className="max-h-64 overflow-y-auto space-y-2 border rounded-md p-3">
							{Array.from(selectedRepos.values()).map((repo) => (
								<div
									key={repo.fullName}
									className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded"
								>
									<div>
										<p className="font-medium">{toKebabCase(repo.name)}</p>
										<p className="text-xs text-muted-foreground">
											{repo.fullName}
										</p>
									</div>
									<Badge variant="outline">service</Badge>
								</div>
							))}
						</div>

						<p className="text-sm text-muted-foreground">
							{selectedRepos.size} service{selectedRepos.size !== 1 ? "s" : ""}{" "}
							will be created.
						</p>
					</div>
				)}

				{/* Import progress */}
				{step === "review" && importProgress && (
					<div className="space-y-4">
						<Progress
							value={(importProgress.current / importProgress.total) * 100}
						/>
						<p className="text-sm text-muted-foreground text-center">
							{importProgress.importing
								? `Importing ${importProgress.current} of ${importProgress.total}...`
								: `Import complete: ${importProgress.results.filter((r) => r.success).length} succeeded, ${importProgress.results.filter((r) => !r.success).length} failed`}
						</p>

						{!importProgress.importing && (
							<div className="max-h-48 overflow-y-auto space-y-1">
								{importProgress.results.map((result) => (
									<div
										key={result.name}
										className={cn(
											"flex items-center gap-2 text-sm p-2 rounded",
											result.success
												? "text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-950/30"
												: "text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-950/30",
										)}
									>
										{result.success ? (
											<Check className="h-3 w-3 shrink-0" />
										) : (
											<AlertCircle className="h-3 w-3 shrink-0" />
										)}
										<span className="font-medium">{result.name}</span>
										{result.error && (
											<span className="text-xs truncate">— {result.error}</span>
										)}
									</div>
								))}
							</div>
						)}
					</div>
				)}

				<DialogFooter>
					{step === "connection" && vcsConnections.length > 0 && (
						<Button
							onClick={() => {
								if (vcsConnections.length === 1) {
									setSelectedConnectionId(vcsConnections[0].id);
								}
								handleGoToStep("browse");
							}}
							disabled={!activeConnectionId}
						>
							Next
							<ChevronRight className="h-4 w-4 ml-1" />
						</Button>
					)}

					{step === "browse" && (
						<>
							<Button
								variant="outline"
								onClick={() => handleGoToStep("connection")}
							>
								Back
							</Button>
							<Button
								onClick={() => handleGoToStep("review")}
								disabled={selectedRepos.size === 0}
							>
								Review ({selectedRepos.size})
								<ChevronRight className="h-4 w-4 ml-1" />
							</Button>
						</>
					)}

					{step === "review" && !importProgress && (
						<>
							<Button
								variant="outline"
								onClick={() => handleGoToStep("browse")}
							>
								Back
							</Button>
							<Button onClick={handleImport}>
								Import {selectedRepos.size} Service
								{selectedRepos.size !== 1 ? "s" : ""}
							</Button>
						</>
					)}

					{step === "review" && importProgress && !importProgress.importing && (
						<Button onClick={handleClose}>Done</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
