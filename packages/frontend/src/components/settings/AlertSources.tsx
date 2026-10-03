// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ConnectionWithIntegration } from "@prismalens/contracts/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { useId, useState } from "react";
import { Mono } from "@/components/shared/Mono";
import { MutationError } from "@/components/shared/MutationError";
import { Segmented } from "@/components/shared/Segmented";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ago, useNow } from "@/hooks/use-now";
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
import { cn } from "@/lib/utils";
import { DeleteConnectionDialog } from "./DeleteConnectionDialog";
import { PULL_TEMPLATES } from "./SettingsFrame";

type Kind = "alertmanager" | "prometheus";
const KIND_LABEL: Record<Kind, string> = {
	alertmanager: "Alertmanager",
	prometheus: "Prometheus",
};

function Copy({ value, testId }: { value: string; testId: string }) {
	const { toast } = useToast();
	return (
		<Button
			variant="secondary"
			size="sm"
			onClick={() => {
				void navigator.clipboard?.writeText(value);
				toast({ title: "Copied" });
			}}
			data-testid={testId}
		>
			Copy
		</Button>
	);
}

/**
 * Settings, Alert sources (study-v3 §7): where alerts come from. The webhook
 * Alertmanager pushes to, with its token and the last delivery; then the
 * sources PrismaLens pulls from by URL. One section, no Connections tab.
 */
export function AlertSources() {
	const now = useNow();
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
			<SettingGroup title="Webhook" testId="sources-webhook">
				<SettingRow
					label="Alertmanager receiver URL"
					description={
						<Mono className="break-all">{webhookUrl("prometheus")}</Mono>
					}
					testId="webhook-url"
				>
					<Copy value={webhookUrl("prometheus")} testId="copy-webhook-url" />
				</SettingRow>
				<SettingRow
					label="Generic webhook URL"
					description={
						<Mono className="break-all">{webhookUrl("generic")}</Mono>
					}
				>
					<Copy value={webhookUrl("generic")} testId="copy-generic-url" />
				</SettingRow>
				<SettingRow
					label="Token"
					testId="webhook-token"
					description={
						token ? (
							<>
								Send it as <Mono>Authorization: Bearer</Mono>, as the basic-auth
								password, or as the HMAC key.{" "}
								<Mono className="break-all" data-testid="webhook-token-value">
									{shown ? token.token : maskToken(token.token)}
								</Mono>
							</>
						) : tokenHidden ? (
							"Shown only in a browser on the machine PrismaLens runs on."
						) : (
							"Loading"
						)
					}
				>
					{token && (
						<>
							<Button
								variant="secondary"
								size="sm"
								onClick={() => setShown((v) => !v)}
								data-testid="webhook-token-show"
							>
								{shown ? "Hide" : "Show"}
							</Button>
							<Copy value={token.token} testId="copy-webhook-token" />
						</>
					)}
				</SettingRow>
				<SettingRow
					label="Last delivery"
					testId="webhook-last-delivery"
					description={
						delivery
							? `${formatClock(delivery.at)} ${new Date(delivery.at).toDateString() === new Date().toDateString() ? "today" : formatDate(delivery.at)}. ${delivery.received} alert${delivery.received === 1 ? "" : "s"}, ${delivery.accepted === delivery.received ? "accepted" : `${delivery.accepted} accepted`}.`
							: "Nothing has arrived yet."
					}
				/>
			</SettingGroup>

			<SettingGroup
				title="Pulled from"
				count={sources.length || undefined}
				testId="sources-pulled"
				actions={
					<Button
						variant="ghost"
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
				{sources.map((c) => (
					<SourceRow key={c.id} connection={c} now={now} />
				))}
			</SettingGroup>
			<AddSourceDialog open={adding} onOpenChange={setAdding} />
		</>
	);
}

function SourceRow({
	connection,
	now,
}: {
	connection: ConnectionWithIntegration;
	now: number | null;
}) {
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
		onError: (e) =>
			toast({
				title: "Pull failed",
				description: getErrorMessage(e),
				variant: "destructive",
			}),
	});
	const reachable = connection.status === "ACTIVE";
	const error = test.data?.error ?? connection.lastErrorMessage;
	return (
		<SettingRow
			testId="source-row"
			label={
				<span className="flex flex-wrap items-baseline gap-x-2">
					<span data-testid="source-name">{connection.label}</span>
					<span
						className={cn(
							"text-meta font-medium",
							reachable ? "text-ok" : "text-danger",
						)}
						data-testid="source-state"
					>
						{reachable ? "reachable" : "unreachable"}
					</span>
				</span>
			}
			description={
				<>
					<Mono className="break-all" data-testid="source-url">
						{connection.baseUrl ?? connection.templateName}
					</Mono>
					{!reachable && error
						? `. Last error ${connection.lastErrorAt ? ago(connection.lastErrorAt, now) : ""}: ${error}`
						: "."}
				</>
			}
		>
			<Button
				variant="ghost"
				size="sm"
				disabled={test.isPending}
				onClick={() => test.mutate({ id: connection.id })}
			>
				Test
			</Button>
			<Button
				variant="ghost"
				size="sm"
				disabled={pull.isPending}
				onClick={() => pull.mutate({})}
			>
				Pull now
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon-sm" aria-label="More">
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						className="text-danger"
						onClick={() => {
							remove.reset();
							setRemoving(true);
						}}
					>
						Remove
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<DeleteConnectionDialog
				open={removing}
				onOpenChange={setRemoving}
				connectionId={connection.id}
				error={remove.error}
				onDelete={() =>
					remove.mutate(
						{ id: connection.id },
						{
							onSuccess: () => setRemoving(false),
							onError: (e) =>
								toast({
									title: "Remove failed",
									description: getErrorMessage(e),
									variant: "destructive",
								}),
						},
					)
				}
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
	const [url, setUrl] = useState("");
	const [name, setName] = useState("");
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
			setUrl("");
			setName("");
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
						delivery. Reachable from this machine without credentials.
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
					<div className="space-y-1.5">
						<label htmlFor={urlId} className="block text-body font-medium">
							URL
						</label>
						<Input
							id={urlId}
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder={
								kind === "alertmanager"
									? "http://alertmanager.internal:9093"
									: "http://prometheus.internal:9090"
							}
							data-testid="source-url-input"
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor={nameId} className="block text-body font-medium">
							Name
						</label>
						<Input
							id={nameId}
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder={`Lab ${KIND_LABEL[kind]}`}
							data-testid="source-name-input"
						/>
					</div>
					<MutationError error={error as Error | null} />
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
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
