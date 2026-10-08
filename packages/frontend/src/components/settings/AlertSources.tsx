// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ConnectionWithIntegration } from "@prismalens/contracts/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { CopyButton } from "@/components/shared/CopyButton";
import { Mono } from "@/components/shared/Mono";
import { MutationError } from "@/components/shared/MutationError";
import { Pool } from "@/components/shared/Row";
import { Segmented } from "@/components/shared/Segmented";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
	useConnections,
	useCreateConnection,
	useCreateIntegration,
	useDeleteConnection,
	useIntegrations,
	useTestConnection,
} from "@/lib/api/hooks";
import { alertKeys } from "@/lib/api/hooks/use-alerts-orpc";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import {
	maskToken,
	useLastDelivery,
	useWebhookToken,
	webhookUrl,
} from "@/lib/api/hooks/use-webhooks-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { formatClock, formatDate } from "@/lib/format-time";
import { getErrorMessage } from "@/lib/get-error-message";
import { DeleteConnectionDialog } from "./DeleteConnectionDialog";
import { Field } from "./Field";
import { PULL_TEMPLATES } from "./SettingsFrame";

type Kind = "alertmanager" | "prometheus";
const KIND_LABEL: Record<Kind, string> = {
	alertmanager: "Alertmanager",
	prometheus: "Prometheus",
};

interface SourceFields {
	url: string;
	name: string;
}
const EMPTY_FIELDS: Record<Kind, SourceFields> = {
	alertmanager: { url: "", name: "" },
	prometheus: { url: "", name: "" },
};

/**
 * Settings, Alert sources (study-v3 §7): where alerts come from. The webhook
 * Alertmanager pushes to, with its token and the last delivery; then the
 * sources PrismaLens pulls from by URL. One section, no Connections tab.
 */
export function AlertSources() {
	const { data: token, isError: tokenHidden } = useWebhookToken();
	const { data: delivery } = useLastDelivery();
	const [shown, setShown] = useState(false);
	const [adding, setAdding] = useState(false);
	const { data: connections } = useConnections();
	const sources = (connections ?? []).filter((c) =>
		PULL_TEMPLATES.has(c.templateId ?? ""),
	);
	return (
		<>
			<SettingGroup
				title="Webhook"
				testId="sources-webhook"
				description="Alertmanager pushes here. Send the token as the bearer token, the basic-auth password or the HMAC key."
			>
				<Pool>
					<SettingRow
						label="Alertmanager receiver URL"
						description={<Mono>{webhookUrl("prometheus")}</Mono>}
						testId="webhook-url"
					>
						<CopyButton
							value={webhookUrl("prometheus")}
							testId="copy-webhook-url"
						/>
					</SettingRow>
					<SettingRow
						label="Generic webhook URL"
						description={<Mono>{webhookUrl("generic")}</Mono>}
					>
						<CopyButton
							value={webhookUrl("generic")}
							testId="copy-generic-url"
						/>
					</SettingRow>
					<SettingRow
						label="Token"
						testId="webhook-token"
						description={
							token ? (
								<Mono data-testid="webhook-token-value">
									{shown ? token.token : maskToken(token.token)}
								</Mono>
							) : tokenHidden ? (
								"Shown only in a browser on the machine PrismaLens runs on"
							) : (
								"\u00a0"
							)
						}
					>
						{token && (
							<>
								<Button
									variant="text"
									size="sm"
									onClick={() => setShown((v) => !v)}
									data-testid="webhook-token-show"
								>
									{shown ? "Hide" : "Show"}
								</Button>
								<CopyButton value={token.token} testId="copy-webhook-token" />
							</>
						)}
					</SettingRow>
					<SettingRow
						label="Last delivery"
						testId="webhook-last-delivery"
						description={
							delivery ? (
								<>
									{formatClock(delivery.at)}{" "}
									{new Date(delivery.at).toDateString() ===
									new Date().toDateString()
										? "today"
										: formatDate(delivery.at)}
									.{" "}
									<StateWord
										tone={
											delivery.accepted === delivery.received ? "ok" : "warn"
										}
									>
										{delivery.received} alert
										{delivery.received === 1 ? "" : "s"},{" "}
										{delivery.accepted === delivery.received
											? "accepted"
											: `${delivery.accepted} accepted`}
									</StateWord>
								</>
							) : (
								"Nothing has arrived yet"
							)
						}
					/>
				</Pool>
			</SettingGroup>

			<SettingGroup
				title="Pulled from"
				count={sources.length || undefined}
				testId="sources-pulled"
				actions={
					<Button
						variant="text"
						size="sm"
						onClick={() => setAdding(true)}
						data-testid="add-source"
					>
						Add a source
					</Button>
				}
				description={
					sources.length === 0
						? "Alertmanager or Prometheus by URL: PrismaLens pulls the firing alerts on start and after each delivery."
						: undefined
				}
			>
				{sources.length > 0 && (
					<Pool>
						{sources.map((c) => (
							<SourceRow key={c.id} connection={c} />
						))}
					</Pool>
				)}
			</SettingGroup>
			<AddSourceDialog open={adding} onOpenChange={setAdding} />
		</>
	);
}

/** A network failure in words; an answer the source gave stays as the API words it. */
function failureSentence(message: string): string {
	return /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket|network/i.test(
		message,
	)
		? "Nothing answered at that address"
		: message.replace(/\.$/, "");
}

function SourceRow({ connection }: { connection: ConnectionWithIntegration }) {
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const test = useTestConnection();
	const remove = useDeleteConnection();
	const [removing, setRemoving] = useState(false);
	const pull = useMutation({
		...orpc.alerts.pull.mutationOptions(),
		onSuccess: (r) => {
			toast({
				title: `Pulled ${r.received + r.caughtUp} alerts, ${r.processed} new`,
			});
			queryClient.invalidateQueries({ queryKey: alertKeys.all() });
			queryClient.invalidateQueries({ queryKey: incidentKeys.all() });
		},
		onError: () =>
			toast({
				title: "Pull failed",
				description: `${connection.label} did not answer. The row says why.`,
				variant: "destructive",
			}),
	});
	const reachable = connection.status === "ACTIVE";
	const error = test.data?.error ?? connection.lastErrorMessage;
	const tried = connection.lastErrorAt ?? connection.updatedAt;
	return (
		<SettingRow
			testId="source-row"
			label={
				<span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
					<span data-testid="source-name">{connection.label}</span>
					{/* Pulls read ACTIVE sources only, so an unreachable one waits for Test. */}
					<StateWord
						tone={reachable ? "neutral" : "danger"}
						data-testid="source-state"
					>
						{reachable ? "Reachable" : "Unreachable"}
					</StateWord>
				</span>
			}
			description={
				<>
					<Mono data-testid="source-url">
						{connection.baseUrl ?? connection.templateName}
					</Mono>
					{!reachable &&
						error &&
						`. ${failureSentence(error)} at ${formatClock(tried)}; pulls skip it until Test reaches it.`}
				</>
			}
		>
			<Button
				variant="text"
				size="sm"
				disabled={test.isPending}
				onClick={() =>
					// Test says what it found, not only the row (#673 w16).
					test.mutate(
						{ id: connection.id },
						{
							onSuccess: (r) =>
								toast(
									r.success
										? { title: "Reachable" }
										: {
												title: "Unreachable",
												description: failureSentence(
													r.error ?? "it did not answer",
												),
												variant: "destructive",
											},
								),
							onError: (e) =>
								toast({
									title: "Test did not run",
									description: getErrorMessage(e),
									variant: "destructive",
								}),
						},
					)
				}
				data-testid="source-test"
			>
				Test
			</Button>
			<Button
				variant="text"
				size="sm"
				disabled={pull.isPending}
				onClick={() => pull.mutate({})}
			>
				Pull now
			</Button>
			<Button
				variant="danger"
				size="sm"
				onClick={() => {
					remove.reset();
					setRemoving(true);
				}}
				data-testid="source-remove"
			>
				Remove
			</Button>
			<DeleteConnectionDialog
				open={removing}
				onOpenChange={setRemoving}
				connectionId={connection.id}
				error={remove.error}
				onDelete={() => remove.mutateAsync({ id: connection.id })}
				onCancel={() => setRemoving(false)}
				isDeleting={remove.isPending}
			/>
		</SettingRow>
	);
}

/** Add a source: its kind, its URL and a name; PrismaLens checks it can reach it. */
function AddSourceDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [kind, setKind] = useState<Kind>("alertmanager");
	// Each kind keeps its own fields, so a URL typed for one never lands on the other (#673 w56).
	const [fields, setFields] = useState(EMPTY_FIELDS);
	const { url, name } = fields[kind];
	const setField = (patch: Partial<SourceFields>) =>
		setFields((f) => ({ ...f, [kind]: { ...f[kind], ...patch } }));
	const urlId = useId();
	const nameId = useId();
	const { data: integrations } = useIntegrations();
	const createIntegration = useCreateIntegration();
	const createConnection = useCreateConnection();
	const test = useTestConnection();
	const [error, setError] = useState<unknown>(null);
	const pending =
		createIntegration.isPending || createConnection.isPending || test.isPending;

	const add = async () => {
		setError(null);
		try {
			const existing = integrations?.find((i) => i.templateId === kind);
			const integrationId =
				existing?.id ??
				(
					await createIntegration.mutateAsync({
						templateId: kind,
						label: KIND_LABEL[kind],
					})
				).id;
			const connection = await createConnection.mutateAsync({
				integrationId,
				label: name.trim() || KIND_LABEL[kind],
				credentials: {},
				connectionConfig: { baseUrl: url.trim() },
			});
			// Reachable or not, the row says which; a failed check is not a failed add.
			await test.mutateAsync({ id: connection.id }).catch(() => undefined);
			onOpenChange(false);
			setFields(EMPTY_FIELDS);
		} catch (e) {
			setError(e);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="add-source-dialog">
				<DialogHeader>
					<DialogTitle>Add a source</DialogTitle>
					<DialogDescription>
						PrismaLens pulls what is firing from it, on start and after each
						delivery. It must answer from this machine without credentials.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<Segmented
						label="Kind"
						value={kind}
						onChange={setKind}
						options={[
							{ value: "alertmanager", label: "Alertmanager" },
							{ value: "prometheus", label: "Prometheus" },
						]}
						testId="source-kind"
					/>
					<Field label="URL" htmlFor={urlId}>
						<Input
							id={urlId}
							value={url}
							onChange={(e) => setField({ url: e.target.value })}
							placeholder={
								kind === "alertmanager"
									? "http://alertmanager.internal:9093"
									: "http://prometheus.internal:9090"
							}
							data-testid="source-url-input"
						/>
					</Field>
					<Field label="Name" note="optional" htmlFor={nameId}>
						<Input
							id={nameId}
							value={name}
							onChange={(e) => setField({ name: e.target.value })}
							placeholder={`Lab ${KIND_LABEL[kind]}`}
							data-testid="source-name-input"
						/>
					</Field>
					<div className="min-h-5">
						<MutationError error={error as Error | null} />
					</div>
				</div>
				<DialogFooter>
					<Button variant="text" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						variant="primary"
						disabled={!url.trim() || pending}
						onClick={add}
						data-testid="add-source-submit"
					>
						Add
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
