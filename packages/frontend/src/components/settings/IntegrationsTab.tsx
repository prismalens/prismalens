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
import { Fragment, useState } from "react";
import { Pool } from "@/components/shared/Row";
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
import { formatDate } from "@/lib/format-time";
import { ConnectionFormDialog } from "./ConnectionFormDialog";
import { DeleteConnectionDialog } from "./DeleteConnectionDialog";
import { DeleteIntegrationDialog } from "./DeleteIntegrationDialog";
import { IntegrationFormDialog } from "./IntegrationFormDialog";
import { ConnectionStatusBadge } from "./integration-utils";
import { PULL_TEMPLATES } from "./SettingsFrame";

/** Edit and Remove for a row: two items, so a menu (a one-item menu is a button). */
function RowMenu({
	onEdit,
	onRemove,
}: {
	onEdit: () => void;
	onRemove: () => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="text" size="icon-sm" aria-label="More">
					<MoreHorizontal />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
				<DropdownMenuItem className="text-danger" onClick={onRemove}>
					Remove
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

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
			title="Git hosts"
			count={shown.length || undefined}
			testId="integrations-list"
			actions={
				<Button
					variant="text"
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
			{shown.length > 0 && (
				<Pool>
					{shown.map((integration) => {
						const template = templates?.find(
							(t) => t.id === integration.templateId,
						);
						const rows = accounts(integration.id);
						return (
							<Fragment key={integration.id}>
								<SettingRow
									testId="integration-row"
									label={integration.label}
									description={
										template?.authModeLabel ??
										template?.name ??
										integration.templateId
									}
								>
									<Button
										variant="text"
										size="sm"
										onClick={() => setConnectFor(integration.id)}
									>
										Connect an account
									</Button>
									<RowMenu
										onEdit={() => setEditing(integration)}
										onRemove={() => setRemoveIntegration(integration.id)}
									/>
								</SettingRow>
								{rows.map((c) => (
									<SettingRow
										key={c.id}
										className="pl-4"
										label={
											<span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
												{c.label}
												<ConnectionStatusBadge status={c.status} />
											</span>
										}
										description={
											test.variables?.id === c.id && test.data
												? test.data.success
													? "Answered just now"
													: test.data.error
												: `Connected ${formatDate(c.createdAt)}`
										}
									>
										<Button
											variant="text"
											size="sm"
											disabled={test.isPending}
											onClick={() => test.mutate({ id: c.id })}
										>
											Test
										</Button>
										<RowMenu
											onEdit={() => setEditConnection(c)}
											onRemove={() => setRemoveConnection(c.id)}
										/>
									</SettingRow>
								))}
							</Fragment>
						);
					})}
				</Pool>
			)}

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
