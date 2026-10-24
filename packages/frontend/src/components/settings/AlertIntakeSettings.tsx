// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { webhooksContract } from "@prismalens/contracts";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/shared/CopyButton";
import { Mono } from "@/components/shared/Mono";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Button } from "@/components/ui/button";
import { useConnections } from "@/lib/api/hooks";
import { useSourcesOverview } from "@/lib/api/hooks/use-sources-orpc";
import {
	maskToken,
	useLastDelivery,
	useWebhookToken,
	webhookUrl,
} from "@/lib/api/hooks/use-webhooks-orpc";
import { formatClock, formatDate } from "@/lib/format-time";
import { ConnectionFormDialog } from "./ConnectionFormDialog";
import { SourceConnectDialog } from "./SourceConnectDialog";
import {
	AlsoInNote,
	hostOf,
	KindIcon,
	StatePill,
	sourceState,
	type Word,
} from "./source-words";

/** Deploy-event intake draws only once #855's route is in the contract; no placeholder before. */
const DEPLOY_INTAKE = "deploy" in webhooksContract;

const when = (at: string) =>
	`${formatClock(at)} ${
		new Date(at).toDateString() === new Date().toDateString()
			? "today"
			: formatDate(at)
	}`;

/**
 * Settings, Alert intake (#848): what starts an investigation. The webhooks
 * with their token and last delivery, deploy-event intake, and the sources
 * pulled by URL; a pulled source is also a Source, so its row says so.
 */
export function AlertIntakeSettings() {
	const { data: token, isError: tokenHidden } = useWebhookToken();
	const { data: delivery } = useLastDelivery();
	const [shown, setShown] = useState(false);
	const [adding, setAdding] = useState(false);
	const [editing, setEditing] = useState<string | null>(null);
	const { data: overview } = useSourcesOverview();
	const { data: connections } = useConnections();
	const pulled = (overview?.sources ?? []).filter((s) => s.alsoInAlertIntake);
	const accepted =
		delivery && delivery.accepted === delivery.received
			? `${delivery.received} alert${delivery.received === 1 ? "" : "s"}, accepted`
			: delivery
				? `${delivery.received} alert${delivery.received === 1 ? "" : "s"}, ${delivery.accepted} accepted`
				: "";
	const deliveryWord: Word | null = delivery
		? {
				text: accepted,
				tone: delivery.accepted === delivery.received ? "ok" : "warn",
			}
		: null;
	return (
		<>
			<SettingGroup
				title="Webhooks"
				testId="sources-webhook"
				description="Send the token as the bearer token, the basic-auth password or the HMAC key."
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
								" "
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
									<span className="tabular-nums">{when(delivery.at)}</span>
									<span className="sr-only">. {accepted}</span>
								</>
							) : (
								"Nothing has arrived yet"
							)
						}
					>
						{deliveryWord && <StatePill word={deliveryWord} />}
					</SettingRow>
				</Pool>
			</SettingGroup>

			{DEPLOY_INTAKE && (
				<SettingGroup title="Deploy events" testId="sources-deploy">
					<Pool>
						<SettingRow
							label="Deploy events URL"
							description={
								<Mono>
									{webhookUrl("generic").replace(/generic$/, "deploy")}
								</Mono>
							}
						>
							<CopyButton
								value={webhookUrl("generic").replace(/generic$/, "deploy")}
							/>
						</SettingRow>
					</Pool>
				</SettingGroup>
			)}

			<SettingGroup
				title="Pulled by URL"
				count={pulled.length || undefined}
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
			>
				<Pool className="divide-y divide-hairline">
					{pulled.length === 0 ? (
						<SettingRow
							label="Nothing pulled"
							description="Alertmanager and Prometheus connections can also be pulled for alerts."
						/>
					) : (
						pulled.map((s) => (
							<div
								key={s.connectionId}
								className="flex min-h-16 items-start gap-3 py-3"
								data-testid="source-row"
							>
								<KindIcon kind={s.kind} />
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="text-heading" data-testid="source-name">
											{s.label}
										</span>
										<StatePill word={sourceState(s)} testId="source-state" />
									</div>
									<div className="truncate text-meta text-text-2">
										<Mono data-testid="source-url">{hostOf(s.address)}</Mono>
									</div>
									<div className="mt-1">
										<AlsoInNote page="Sources" />
									</div>
								</div>
								<Button
									variant="secondary"
									size="sm"
									onClick={() => setEditing(s.connectionId)}
									data-testid="source-edit"
								>
									<Pencil className="size-3.5" />
									Edit
								</Button>
							</div>
						))
					)}
				</Pool>
			</SettingGroup>
			<SourceConnectDialog
				open={adding}
				onOpenChange={setAdding}
				initialKind="alertmanager"
			/>
			<ConnectionFormDialog
				open={!!editing}
				onOpenChange={(o) => !o && setEditing(null)}
				mode="edit"
				connection={connections?.find((c) => c.id === editing) ?? null}
			/>
		</>
	);
}
