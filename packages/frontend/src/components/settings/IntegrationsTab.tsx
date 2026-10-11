// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type {
	ConnectionWithIntegration,
	Integration,
	TestConnectionResponse,
} from "@prismalens/contracts/schemas";
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
import { cn } from "@/lib/utils";
import { ConnectionFormDialog } from "./ConnectionFormDialog";
import { DeleteConnectionDialog } from "./DeleteConnectionDialog";
import { DeleteIntegrationDialog } from "./DeleteIntegrationDialog";
import { IntegrationFormDialog } from "./IntegrationFormDialog";
import { ConnectionStatusBadge } from "./integration-utils";
import { PULL_TEMPLATES } from "./SettingsFrame";

const GIT_HOST_TOKEN = "git-host-token";
const LEGACY_LABEL = "GitHub App (removed in 0.5.1)";
const LEGACY_COPY =
	"This connection no longer works. Delete it here, then delete the app or its private key on GitHub (Settings → Developer settings → GitHub Apps).";

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

/** What a Test answered: each repository tried, or why it could not try yet (neutral, not a failure). */
function TestAnswer({ result }: { result: TestConnectionResponse }) {
	const lines = result.details?.length
		? result.details
		: [result.success ? "Answered just now" : (result.error ?? "Failed")];
	return (
		<span
			className={cn(
				"block",
				!result.success && !result.untested && "text-danger",
			)}
			data-testid={result.untested ? "test-untested" : "test-answer"}
		>
			{lines.join("; ")}
		</span>
	);
}

/** Where a token row says what it is: its host and fingerprint, never the token. */
function tokenFacts(c: ConnectionWithIntegration): string {
	const facts = [
		c.host,
		c.fingerprint ? `fp ${c.fingerprint}` : null,
		`added ${formatDate(c.createdAt)}`,
	].filter(Boolean);
	return facts.join(", ");
}

/**
 * Git host tokens and any other integration that is not an alert source,
 * each with its saved accounts as rows. A run clones with this machine's own
 * git login until a token is added for a host it cannot reach (#673).
 */
export function IntegrationsTab() {
	const { data: integrations } = useIntegrations();
	const { data: connections } = useConnections();
	const { data: templates } = useTemplates();
	const deleteIntegration = useDeleteIntegration();
	const deleteConnection = useDeleteConnection();
	const test = useTestConnection();

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
	const tokenIntegration = shown.find((i) => i.templateId === GIT_HOST_TOKEN);
	const addToken = () =>
		setConnectFor(tokenIntegration?.id ?? `new:${GIT_HOST_TOKEN}`);

	return (
		<SettingGroup
			title="Git hosts"
			count={shown.length || undefined}
			testId="integrations-list"
			actions={
				<Button
					variant="text"
					size="sm"
					onClick={addToken}
					data-testid="add-integration"
				>
					Add a token
				</Button>
			}
			description={
				shown.length === 0
					? "None yet. Runs clone with this machine's own git login until you add a token for a host it can't reach."
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
						// A template this build no longer ships: its rows only offer Delete.
						const legacy = !!templates && !template;
						const addable =
							template?.gitHost === true && template.listed !== false;
						return (
							<Fragment key={integration.id}>
								<SettingRow
									testId="integration-row"
									label={legacy ? LEGACY_LABEL : integration.label}
									description={
										legacy
											? LEGACY_COPY
											: (template?.authModeLabel ??
												template?.name ??
												integration.templateId)
									}
								>
									{legacy ? (
										<Button
											variant="danger"
											size="sm"
											onClick={() => setRemoveIntegration(integration.id)}
										>
											Delete
										</Button>
									) : (
										<>
											{addable && (
												<Button
													variant="text"
													size="sm"
													onClick={() => setConnectFor(integration.id)}
												>
													Add a token
												</Button>
											)}
											<RowMenu
												onEdit={() => setEditing(integration)}
												onRemove={() => setRemoveIntegration(integration.id)}
											/>
										</>
									)}
								</SettingRow>
								{rows.map((c) => (
									<SettingRow
										key={c.id}
										className="pl-4"
										testId="connection-row"
										label={
											<span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
												{c.legacy ? `${LEGACY_LABEL}: ${c.label}` : c.label}
												{!c.legacy && (
													<ConnectionStatusBadge status={c.status} />
												)}
											</span>
										}
										description={
											c.legacy ? (
												LEGACY_COPY
											) : test.variables?.id === c.id && test.data ? (
												<TestAnswer result={test.data} />
											) : (
												<>
													<span className="block">
														{c.host
															? tokenFacts(c)
															: `Connected ${formatDate(c.createdAt)}`}
													</span>
													{c.host &&
														c.status !== "ACTIVE" &&
														c.lastErrorMessage && (
															<span className="block text-danger">
																{c.lastErrorMessage}
															</span>
														)}
												</>
											)
										}
									>
										{c.legacy ? (
											<Button
												variant="danger"
												size="sm"
												onClick={() => setRemoveConnection(c.id)}
											>
												Delete
											</Button>
										) : (
											<>
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
											</>
										)}
									</SettingRow>
								))}
							</Fragment>
						);
					})}
				</Pool>
			)}

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
