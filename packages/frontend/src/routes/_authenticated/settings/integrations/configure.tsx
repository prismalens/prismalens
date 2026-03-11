"use client";

/**
 * Integration Configuration Page
 *
 * Used after OAuth callback to configure git provider integrations
 * (select organizations, repositories, etc.)
 * Also used for GitHub App installation selection.
 */

import { useState } from "react";
import {
	createFileRoute,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import {
	AlertCircle,
	ArrowLeft,
	Building2,
	CheckCircle,
	Loader2,
} from "lucide-react";
import { getIntegrationIcon } from "@/lib/integration-icons";
import { GitRepoSelector } from "@/components/settings/GitRepoSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	useConnection,
	useConnectGitHubInstallation,
	useGitHubInstallations,
	useGitOrganizations,
	useGitRepositories,
	useUpdateConnectionConfig,
} from "@/lib/api/hooks";

// Search params type
interface ConfigureSearchParams {
	connectionId?: string;
	provider?: string;
	integrationId?: string;
	mode?: string;
}

export const Route = createFileRoute(
	"/_authenticated/settings/integrations/configure",
)({
	validateSearch: (
		search: Record<string, unknown>,
	): ConfigureSearchParams => ({
		connectionId:
			typeof search.connectionId === "string"
				? search.connectionId
				: undefined,
		provider:
			typeof search.provider === "string" ? search.provider : undefined,
		integrationId:
			typeof search.integrationId === "string"
				? search.integrationId
				: undefined,
		mode: typeof search.mode === "string" ? search.mode : undefined,
	}),
	component: ConfigureIntegrationPage,
});

function ConfigureIntegrationPage() {
	const navigate = useNavigate();
	const search = useSearch({
		from: "/_authenticated/settings/integrations/configure",
	});
	const { connectionId, provider, integrationId, mode } = search;

	// GitHub App installation selection mode
	if (mode === "github-app" && integrationId) {
		return (
			<GitHubAppInstallationWizard
				integrationId={integrationId}
				onDone={() =>
					navigate({ to: "/settings", search: { tab: "integrations" } })
				}
				onCancel={() =>
					navigate({ to: "/settings", search: { tab: "integrations" } })
				}
			/>
		);
	}

	// Standard OAuth configure flow (existing)
	return (
		<StandardConfigurePage
			connectionId={connectionId}
			provider={provider}
		/>
	);
}

// =============================================================================
// GITHUB APP INSTALLATION WIZARD
// =============================================================================

function GitHubAppInstallationWizard({
	integrationId,
	onDone,
	onCancel,
}: {
	integrationId: string;
	onDone: () => void;
	onCancel: () => void;
}) {
	const {
		data: installations,
		isLoading,
		error,
		refetch,
	} = useGitHubInstallations(integrationId);

	const connectInstallation = useConnectGitHubInstallation();
	const [connectingId, setConnectingId] = useState<number | null>(null);
	const [connected, setConnected] = useState(false);
	const [connectError, setConnectError] = useState<string | null>(null);

	const handleConnect = async (installationId: number, orgLogin?: string) => {
		setConnectingId(installationId);
		setConnectError(null);
		try {
			await connectInstallation.mutateAsync({
				id: integrationId,
				installationId: String(installationId),
				organization: orgLogin,
			});
			setConnected(true);
		} catch (err) {
			setConnectError(
				err instanceof Error ? err.message : "Failed to connect installation",
			);
			setConnectingId(null);
		}
	};

	if (connected) {
		return (
			<div className="px-4 py-6 sm:px-0">
				<Card className="max-w-2xl mx-auto">
					<CardContent className="py-12">
						<div className="flex flex-col items-center text-center">
							<CheckCircle className="h-8 w-8 text-green-500 mb-4" />
							<h2 className="text-lg font-semibold mb-2">
								GitHub App Connected
							</h2>
							<p className="text-muted-foreground mb-6">
								Installation token generated. The token will
								auto-refresh every hour.
							</p>
							<Button onClick={onDone}>Done</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="px-4 py-6 sm:px-0">
			<div className="max-w-2xl mx-auto space-y-6">
				<div className="flex items-center gap-4">
					<Button variant="ghost" size="icon" onClick={onCancel}>
						<ArrowLeft className="h-5 w-5" />
					</Button>
					<div className="flex items-center gap-3">
						<div className="flex-shrink-0">
							{getIntegrationIcon("github", "h-6 w-6")}
						</div>
						<div>
							<h1 className="text-xl font-semibold">
								Select Installation
							</h1>
							<p className="text-sm text-muted-foreground">
								Choose which organization or account to connect
							</p>
						</div>
					</div>
				</div>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">
							Available Installations
						</CardTitle>
					</CardHeader>
					<CardContent>
						{isLoading && (
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
							</div>
						)}

						{error && (
							<div className="flex flex-col items-center text-center py-8">
								<AlertCircle className="h-5 w-5 text-destructive mb-3" />
								<p className="text-sm text-destructive mb-4">
									{error instanceof Error
										? error.message
										: "Failed to load installations"}
								</p>
								<Button
									variant="outline"
									size="sm"
									onClick={() => refetch()}
								>
									Retry
								</Button>
							</div>
						)}

						{installations && installations.length === 0 && (
							<div className="flex flex-col items-center text-center py-8">
								<Building2 className="h-5 w-5 text-muted-foreground mb-3" />
								<p className="text-muted-foreground mb-2">
									No installations found
								</p>
								<p className="text-sm text-muted-foreground mb-4">
									Install the GitHub App on an organization or
									account first.
								</p>
								<Button variant="outline" size="sm" onClick={() => refetch()}>
									Refresh
								</Button>
							</div>
						)}

						{connectError && (
							<div className="flex items-center gap-2 p-3 text-sm text-destructive bg-destructive/10 rounded-md mb-3">
								<AlertCircle className="h-4 w-4 flex-shrink-0" />
								{connectError}
							</div>
						)}

						{installations && installations.length > 0 && (
							<div className="space-y-3">
								{installations.map((inst) => (
									<div
										key={inst.id}
										className="flex items-center justify-between p-4 border rounded-lg"
									>
										<div className="flex items-center gap-3">
											<Building2 className="h-5 w-5 text-muted-foreground" />
											<div>
												<p className="font-medium">
													{inst.account.login}
												</p>
												<div className="flex items-center gap-2 mt-1">
													<Badge variant="outline" className="text-xs">
														{inst.account.type}
													</Badge>
													<Badge variant="secondary" className="text-xs">
														{inst.repositorySelection === "all"
															? "All repos"
															: "Selected repos"}
													</Badge>
												</div>
											</div>
										</div>
										<Button
											size="sm"
											onClick={() =>
												handleConnect(
													inst.id,
													inst.account.login,
												)
											}
											disabled={connectingId !== null}
										>
											{connectingId === inst.id ? (
												<Loader2 className="h-4 w-4 animate-spin mr-2" />
											) : null}
											Connect
										</Button>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

// =============================================================================
// STANDARD CONFIGURE PAGE (existing OAuth flow)
// =============================================================================

function StandardConfigurePage({
	connectionId,
	provider,
}: {
	connectionId?: string;
	provider?: string;
}) {
	const navigate = useNavigate();
	const [selectedOrg, setSelectedOrg] = useState<string | undefined>(
		undefined,
	);

	const {
		data: connection,
		isLoading: isLoadingConnection,
		error: connectionError,
	} = useConnection(connectionId ?? "");

	const { data: organizations = [], isLoading: isLoadingOrgs } =
		useGitOrganizations(connectionId ?? "");

	const { data: repositories = [], isLoading: isLoadingRepos } =
		useGitRepositories(connectionId ?? "", selectedOrg);

	const updateConfig = useUpdateConnectionConfig();

	const handleSave = async (config: {
		organization?: string;
		repositories: string[];
		allRepositories: boolean;
		defaultBranch: string;
	}) => {
		if (!connectionId) return;

		await updateConfig.mutateAsync({
			id: connectionId,
			config: {
				organization: config.organization,
				repositories: config.repositories,
				allRepositories: config.allRepositories,
				defaultBranch: config.defaultBranch,
			},
		});

		navigate({
			to: "/settings",
			search: { tab: "integrations" },
		});
	};

	const handleCancel = () => {
		navigate({
			to: "/settings",
			search: { tab: "integrations" },
		});
	};

	// Derive provider name from template ID or search param
	const providerName =
		provider ??
		connection?.templateId?.replace(/-oauth2$|-token$|-app$/, "") ??
		"github";

	const getProviderDisplayName = () => {
		switch (providerName) {
			case "github":
				return "GitHub";
			case "gitlab":
				return "GitLab";
			case "bitbucket":
				return "BitBucket";
			default:
				return "Git Provider";
		}
	};

	const getProviderIcon = () => {
		return getIntegrationIcon(providerName ?? "", "h-6 w-6");
	};

	if (!connectionId) {
		return (
			<div className="px-4 py-6 sm:px-0">
				<Card className="max-w-2xl mx-auto">
					<CardContent className="py-12">
						<div className="flex flex-col items-center text-center">
							<AlertCircle className="h-5 w-5 text-destructive mb-3" />
							<h2 className="text-lg font-semibold mb-2">
								Missing Connection ID
							</h2>
							<p className="text-muted-foreground mb-4">
								No connection ID was provided. Please return to settings
								and try again.
							</p>
							<Button onClick={handleCancel}>
								<ArrowLeft className="h-4 w-4 mr-2" />
								Back to Settings
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (isLoadingConnection) {
		return (
			<div className="px-4 py-6 sm:px-0">
				<Card className="max-w-2xl mx-auto">
					<CardContent className="flex items-center justify-center py-12">
						<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
					</CardContent>
				</Card>
			</div>
		);
	}

	if (connectionError || !connection) {
		return (
			<div className="px-4 py-6 sm:px-0">
				<Card className="max-w-2xl mx-auto">
					<CardContent className="py-12">
						<div className="flex flex-col items-center text-center">
							<AlertCircle className="h-5 w-5 text-destructive mb-3" />
							<h2 className="text-lg font-semibold mb-2">
								Connection Not Found
							</h2>
							<p className="text-muted-foreground mb-4">
								{connectionError?.message ||
									"The connection could not be found. It may have been deleted."}
							</p>
							<Button onClick={handleCancel}>
								<ArrowLeft className="h-4 w-4 mr-2" />
								Back to Settings
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="px-4 py-6 sm:px-0">
			<div className="max-w-2xl mx-auto space-y-6">
				<div className="flex items-center gap-4">
					<Button variant="ghost" size="icon" onClick={handleCancel}>
						<ArrowLeft className="h-5 w-5" />
					</Button>
					<div className="flex items-center gap-3">
						<div className="flex-shrink-0">
							{getProviderIcon()}
						</div>
						<div>
							<h1 className="text-xl font-semibold">
								Configure {getProviderDisplayName()}
							</h1>
							<p className="text-sm text-muted-foreground">
								{connection.integration?.label ??
									connection.templateName ??
									"Connection"}
							</p>
						</div>
					</div>
				</div>

				<GitRepoSelector
					connectionId={connectionId}
					providerName={providerName}
					providerDisplayName={getProviderDisplayName()}
					organizations={organizations}
					repositories={repositories}
					isLoadingOrgs={isLoadingOrgs}
					isLoadingRepos={isLoadingRepos}
					selectedOrg={selectedOrg}
					onOrgChange={setSelectedOrg}
					onSave={handleSave}
					onCancel={handleCancel}
					isSaving={updateConfig.isPending}
				/>
			</div>
		</div>
	);
}
