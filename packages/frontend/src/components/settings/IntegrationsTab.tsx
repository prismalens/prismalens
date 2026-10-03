// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type {
	AuthTemplateResponse,
	ConnectionWithIntegration,
	Integration,
} from "@prismalens/contracts/schemas";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	useConnections,
	useDeleteConnection,
	useDeleteIntegration,
	useIntegrations,
	useTemplates,
	useTestConnection,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { ConnectionFormDialog } from "./ConnectionFormDialog";
import { DeleteConnectionDialog } from "./DeleteConnectionDialog";
import { DeleteIntegrationDialog } from "./DeleteIntegrationDialog";
import { IntegrationFormDialog } from "./IntegrationFormDialog";
import { PULL_TEMPLATES } from "./SettingsFrame";

const STATUS_WORD: Record<string, string> = {
	ACTIVE: "connected",
	TOKEN_EXPIRED: "token expired",
	REFRESH_FAILED: "refresh failed",
	CREDENTIALS_INVALID: "credentials invalid",
	REVOKED: "revoked",
	ERROR: "error",
	PENDING: "pending",
};

/**
 * The integrations that are not alert sources (GitHub and the like), each
 * with the accounts behind it as rows, so there is no Connections tab.
 */
export function IntegrationsTab() {
	const { data: integrations } = useIntegrations();
	const { data: connections } = useConnections();
	const { data: templates } = useTemplates();
	const navigate = useNavigate();
	const deleteIntegration = useDeleteIntegration();
	const deleteConnection = useDeleteConnection();
	const test = useTestConnection();

	const [adding, setAdding] = useState(false);
	const [editing, setEditing] = useState<Integration | null>(null);
	const [connectFor, setConnectFor] = useState<string | null>(null);
	const [editConnection, setEditConnection] =
		useState<ConnectionWithIntegration | null>(null);
	const [removeIntegration, setRemoveIntegration] = useState<string | null>(
		null,
	);
	const [removeConnection, setRemoveConnection] = useState<string | null>(null);

	const shown = (integrations ?? []).filter(
		(i) => !PULL_TEMPLATES.has(i.templateId),
	);
	const accounts = (id: string) =>
		(connections ?? []).filter((c) => c.integrationId === id);

	const handleCreated = async (
		integrationId: string,
		template: AuthTemplateResponse,
	) => {
		if (
			template.postCreationAction === "navigate" &&
			template.postCreationNavigateTo
		) {
			await navigate({
				to: template.postCreationNavigateTo,
				search: {
					integrationId,
					provider: template.id.split("-")[0],
					mode: template.id,
				},
			});
		}
		if (template.postCreationAction === "oauth_redirect") {
			try {
				const res = await fetch(
					`/api/integrations/oauth/${integrationId}/authorize`,
					{
						method: "POST",
						credentials: "include",
						headers: { "Content-Type": "application/json" },
					},
				);
				if (!res.ok) throw new Error(`OAuth authorize failed: ${res.status}`);
				const { redirectUrl } = await res.json();
				window.location.href = redirectUrl;
			} catch {
				// The integration is saved; its account can be connected from its row.
			}
		}
	};

	return (
		<SettingGroup
			title="Integrations"
			count={shown.length || undefined}
			testId="integrations-list"
			actions={
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setAdding(true)}
					data-testid="add-integration"
				>
					Add an integration
				</Button>
			}
			description={
				shown.length === 0
					? "None yet. A git host lets a service name its code by URL."
					: undefined
			}
		>
			{shown.map((integration) => {
				const template = templates?.find(
					(t) => t.id === integration.templateId,
				);
				const rows = accounts(integration.id);
				return (
					<div key={integration.id} data-testid="integration-row">
						<SettingRow
							label={integration.label}
							description={`${template?.name ?? integration.templateId}, ${template?.authModeLabel ?? ""}`.replace(
								/, $/,
								"",
							)}
						>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setConnectFor(integration.id)}
							>
								Connect an account
							</Button>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button variant="ghost" size="icon-sm" aria-label="More">
										<MoreHorizontal />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={() => setEditing(integration)}>
										Edit
									</DropdownMenuItem>
									<DropdownMenuItem
										className="text-danger"
										onClick={() => setRemoveIntegration(integration.id)}
									>
										Remove
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</SettingRow>
						{rows.map((c) => (
							<SettingRow
								key={c.id}
								className="pl-4"
								label={
									<span className="flex flex-wrap items-baseline gap-x-2">
										{c.label}
										<span
											className={cn(
												"text-meta font-medium",
												c.status === "ACTIVE" ? "text-ok" : "text-danger",
											)}
										>
											{STATUS_WORD[c.status] ?? c.status.toLowerCase()}
										</span>
									</span>
								}
								description={
									test.variables?.id === c.id && test.data
										? test.data.success
											? "Answered just now."
											: test.data.error
										: undefined
								}
							>
								<Button
									variant="ghost"
									size="sm"
									disabled={test.isPending}
									onClick={() => test.mutate({ id: c.id })}
								>
									Test
								</Button>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="icon-sm" aria-label="More">
											<MoreHorizontal />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onClick={() => setEditConnection(c)}>
											Edit
										</DropdownMenuItem>
										<DropdownMenuItem
											className="text-danger"
											onClick={() => setRemoveConnection(c.id)}
										>
											Remove
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</SettingRow>
						))}
					</div>
				);
			})}

			<IntegrationFormDialog
				open={adding}
				onOpenChange={setAdding}
				mode="create"
				onCreated={handleCreated}
			/>
			<IntegrationFormDialog
				open={!!editing}
				onOpenChange={(open) => !open && setEditing(null)}
				mode="edit"
				integration={editing}
			/>
			<ConnectionFormDialog
				open={!!connectFor}
				onOpenChange={(open) => !open && setConnectFor(null)}
				mode="create"
				preselectedIntegrationId={connectFor ?? undefined}
			/>
			<ConnectionFormDialog
				open={!!editConnection}
				onOpenChange={(open) => !open && setEditConnection(null)}
				mode="edit"
				connection={editConnection}
			/>
			<DeleteIntegrationDialog
				open={!!removeIntegration}
				onOpenChange={(open) => !open && setRemoveIntegration(null)}
				integrationId={removeIntegration}
				integrationLabel={
					shown.find((i) => i.id === removeIntegration)?.label ?? undefined
				}
				onDelete={async () => {
					if (removeIntegration)
						await deleteIntegration.mutateAsync({ id: removeIntegration });
				}}
				onCancel={() => setRemoveIntegration(null)}
				isDeleting={deleteIntegration.isPending}
			/>
			<DeleteConnectionDialog
				open={!!removeConnection}
				onOpenChange={(open) => !open && setRemoveConnection(null)}
				connectionId={removeConnection}
				onDelete={async () => {
					if (removeConnection)
						await deleteConnection.mutateAsync({ id: removeConnection });
				}}
				onCancel={() => setRemoveConnection(null)}
				isDeleting={deleteConnection.isPending}
			/>
		</SettingGroup>
	);
}
