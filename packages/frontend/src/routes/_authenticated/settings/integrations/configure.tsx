"use client";

/**
 * Integration Configuration Page
 *
 * Used after OAuth callback to configure git provider integrations
 * (select organizations, repositories, etc.)
 */

import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Github, Loader2 } from "lucide-react";
import { GitRepoSelector } from "@/components/settings/GitRepoSelector";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
} from "@/components/ui/card";
import {
	useGitOrganizations,
	useGitRepositories,
	useIntegrationConnection,
	useUpdateConnectionConfig,
} from "@/lib/api/hooks";
import { useState } from "react";

// Search params type
interface ConfigureSearchParams {
	connectionId?: string;
	provider?: string;
}

export const Route = createFileRoute(
	"/_authenticated/settings/integrations/configure",
)({
	validateSearch: (search: Record<string, unknown>): ConfigureSearchParams => ({
		connectionId: typeof search.connectionId === "string" ? search.connectionId : undefined,
		provider: typeof search.provider === "string" ? search.provider : undefined,
	}),
	component: ConfigureIntegrationPage,
});

function ConfigureIntegrationPage() {
	const navigate = useNavigate();
	const search = useSearch({ from: "/_authenticated/settings/integrations/configure" });
	const { connectionId, provider } = search;

	const [selectedOrg, setSelectedOrg] = useState<string | undefined>(undefined);

	// Fetch connection details
	const {
		data: connection,
		isLoading: isLoadingConnection,
		error: connectionError,
	} = useIntegrationConnection(connectionId ?? "");

	// Fetch organizations
	const {
		data: organizations = [],
		isLoading: isLoadingOrgs,
	} = useGitOrganizations(connectionId ?? "");

	// Fetch repositories
	const {
		data: repositories = [],
		isLoading: isLoadingRepos,
	} = useGitRepositories(connectionId ?? "", selectedOrg);

	// Update config mutation
	const updateConfig = useUpdateConnectionConfig();

	// Handle save
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

		// Navigate back to settings
		navigate({
			to: "/settings",
			search: { tab: "integrations" },
		});
	};

	// Handle cancel
	const handleCancel = () => {
		navigate({
			to: "/settings",
			search: { tab: "integrations" },
		});
	};

	// Get provider display name
	const getProviderDisplayName = () => {
		switch (provider || connection?.definition?.name) {
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

	// Get provider icon
	const getProviderIcon = () => {
		switch (provider || connection?.definition?.name) {
			case "github":
				return <Github className="h-6 w-6" />;
			default:
				return <Github className="h-6 w-6" />;
		}
	};

	// No connectionId provided
	if (!connectionId) {
		return (
			<div className="px-4 py-6 sm:px-0">
				<Card className="max-w-2xl mx-auto">
					<CardContent className="py-12">
						<div className="flex flex-col items-center text-center">
							<AlertCircle className="h-12 w-12 text-destructive mb-4" />
							<h2 className="text-lg font-semibold mb-2">
								Missing Connection ID
							</h2>
							<p className="text-muted-foreground mb-4">
								No connection ID was provided. Please return to settings and try
								again.
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

	// Loading state
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

	// Connection error
	if (connectionError || !connection) {
		return (
			<div className="px-4 py-6 sm:px-0">
				<Card className="max-w-2xl mx-auto">
					<CardContent className="py-12">
						<div className="flex flex-col items-center text-center">
							<AlertCircle className="h-12 w-12 text-destructive mb-4" />
							<h2 className="text-lg font-semibold mb-2">Connection Not Found</h2>
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

	// Parse existing config
	const existingConfig = connection.config as
		| {
				organization?: string;
				repositories?: string[];
				allRepositories?: boolean;
				defaultBranch?: string;
		  }
		| undefined;

	return (
		<div className="px-4 py-6 sm:px-0">
			<div className="max-w-2xl mx-auto space-y-6">
				{/* Header */}
				<div className="flex items-center gap-4">
					<Button variant="ghost" size="icon" onClick={handleCancel}>
						<ArrowLeft className="h-5 w-5" />
					</Button>
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
							{getProviderIcon()}
						</div>
						<div>
							<h1 className="text-xl font-semibold">
								Configure {getProviderDisplayName()}
							</h1>
							<p className="text-sm text-muted-foreground">
								{connection.name}
							</p>
						</div>
					</div>
				</div>

				{/* Git Repo Selector */}
				<GitRepoSelector
					connectionId={connectionId}
					providerName={provider || connection.definition?.name || "github"}
					providerDisplayName={getProviderDisplayName()}
					organizations={organizations}
					repositories={repositories}
					isLoadingOrgs={isLoadingOrgs}
					isLoadingRepos={isLoadingRepos}
					selectedOrg={selectedOrg}
					onOrgChange={setSelectedOrg}
					initialConfig={existingConfig}
					onSave={handleSave}
					onCancel={handleCancel}
					isSaving={updateConfig.isPending}
				/>
			</div>
		</div>
	);
}
