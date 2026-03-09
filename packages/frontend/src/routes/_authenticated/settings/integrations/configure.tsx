"use client";

/**
 * Integration Configuration Page
 *
 * Used after OAuth callback to configure git provider integrations
 * (select organizations, repositories, etc.)
 */

import { useState } from "react";
import {
	createFileRoute,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { getIntegrationIcon } from "@/lib/integration-icons";
import { GitRepoSelector } from "@/components/settings/GitRepoSelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	useConnection,
	useGitOrganizations,
	useGitRepositories,
	useUpdateConnectionConfig,
} from "@/lib/api/hooks";

// Search params type
interface ConfigureSearchParams {
	connectionId?: string;
	provider?: string;
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
	}),
	component: ConfigureIntegrationPage,
});

function ConfigureIntegrationPage() {
	const navigate = useNavigate();
	const search = useSearch({
		from: "/_authenticated/settings/integrations/configure",
	});
	const { connectionId, provider } = search;

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
		connection?.templateId?.replace(/-oauth2$|-token$/, "") ??
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
