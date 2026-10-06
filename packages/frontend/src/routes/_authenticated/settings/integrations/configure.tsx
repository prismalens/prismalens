// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Integration Configuration Page
 *
 * Used after OAuth callback to configure git provider integrations
 * (select organizations, repositories, etc.)
 * Also used for GitHub App installation selection.
 */

import {
	createFileRoute,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { ArrowLeft, Building2, Loader2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { GitRepoSelector } from "@/components/settings/GitRepoSelector";
import { MutationError } from "@/components/shared/MutationError";
import { Pool, Row } from "@/components/shared/Row";
import { SettingGroup } from "@/components/shared/SettingRow";
import { Empty, Loading, NotFound, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import {
	useConnectGitHubInstallation,
	useConnection,
	useGitHubInstallations,
	useGitOrganizations,
	useGitRepositories,
	useUpdateConnectionConfig,
} from "@/lib/api/hooks";
import { getIntegrationIcon } from "@/lib/integration-icons";

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
	validateSearch: (search: Record<string, unknown>): ConfigureSearchParams => ({
		connectionId:
			typeof search.connectionId === "string" ? search.connectionId : undefined,
		provider: typeof search.provider === "string" ? search.provider : undefined,
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
		<StandardConfigurePage connectionId={connectionId} provider={provider} />
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
				err instanceof Error
					? err.message
					: "The installation did not connect.",
			);
			setConnectingId(null);
		}
	};

	return (
		<ConfigureFrame
			title="Choose an installation"
			meta="The organization or account the GitHub App reads"
			icon={getIntegrationIcon("github", "size-5")}
			onBack={onCancel}
		>
			{connected ? (
				<Empty
					text="Connected. Its token refreshes on its own every hour."
					action={
						<Button variant="primary" size="sm" onClick={onDone}>
							Done
						</Button>
					}
				/>
			) : (
				<SettingGroup title="Installations" count={installations?.length}>
					{isLoading && <Loading rows={3} />}
					{error && (
						<Problem
							text="The installations did not load."
							onRetry={() => refetch()}
						/>
					)}
					{installations && installations.length === 0 && (
						<Empty
							text="None yet. Install the GitHub App on an organization or account first."
							action={
								<Button variant="text" size="sm" onClick={() => refetch()}>
									Look again
								</Button>
							}
						/>
					)}
					{connectError && (
						<MutationError error={new Error(connectError)} className="mb-2" />
					)}
					{installations && installations.length > 0 && (
						<Pool>
							{installations.map((inst) => (
								<Row
									key={inst.id}
									lead={<Building2 className="size-4 text-text-3" />}
									label={inst.account.login}
									meta={`${inst.account.type}, ${inst.repositorySelection === "all" ? "all repositories" : "chosen repositories"}`}
									trailing={
										<Button
											variant="secondary"
											size="sm"
											onClick={() => handleConnect(inst.id, inst.account.login)}
											disabled={connectingId !== null}
										>
											{connectingId === inst.id && (
												<Loader2 className="size-3.5 motion-safe:animate-spin" />
											)}
											Connect
										</Button>
									}
								/>
							))}
						</Pool>
					)}
				</SettingGroup>
			)}
		</ConfigureFrame>
	);
}

/** The configure page's column: Back, the provider and title, then the content. */
function ConfigureFrame({
	title,
	meta,
	icon,
	onBack,
	children,
}: {
	title: string;
	meta?: string;
	icon?: ReactNode;
	onBack: () => void;
	children: ReactNode;
}) {
	return (
		<div className="mx-auto w-full max-w-(--reading-w) px-4 pt-4 pb-12 md:px-6">
			<Button variant="text" size="sm" className="-ml-2" onClick={onBack}>
				<ArrowLeft />
				Settings
			</Button>
			<div className="mt-3 mb-6 flex items-center gap-3">
				{icon && <span className="text-text-2">{icon}</span>}
				<div className="min-w-0">
					<h1 className="text-title">{title}</h1>
					{meta && <p className="truncate text-meta text-text-3">{meta}</p>}
				</div>
			</div>
			{children}
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
	const [selectedOrg, setSelectedOrg] = useState<string | undefined>(undefined);

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
		return getIntegrationIcon(providerName ?? "", "size-5");
	};

	const frame = (children: ReactNode, meta?: string) => (
		<ConfigureFrame
			title={`Configure ${getProviderDisplayName()}`}
			meta={meta}
			icon={getProviderIcon()}
			onBack={handleCancel}
		>
			{children}
		</ConfigureFrame>
	);

	if (!connectionId)
		return frame(
			<NotFound
				text="No connection was named. Start again from Settings, Integrations."
				back={
					<Button variant="secondary" size="sm" onClick={handleCancel}>
						Back to Settings
					</Button>
				}
			/>,
		);

	if (isLoadingConnection) return frame(<Loading rows={4} />);

	if (connectionError || !connection)
		return frame(
			<NotFound
				back={
					<Button variant="secondary" size="sm" onClick={handleCancel}>
						Back to Settings
					</Button>
				}
			/>,
		);

	return frame(
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
		/>,
		connection.integration?.label ?? connection.templateName ?? "Connection",
	);
}
