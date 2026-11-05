// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { CopyButton } from "@/components/shared/CopyButton";
import { Mono } from "@/components/shared/Mono";
import { Blank } from "@/components/shared/State";
import {
	maskToken,
	useWebhookToken,
	webhookUrl,
} from "@/lib/api/hooks/use-webhooks-orpc";

/** Alerts before the first one: the webhook to point a receiver at, or a source to pull. */
export function AlertsBlank() {
	const { data: token } = useWebhookToken();
	const url = webhookUrl("prometheus");
	return (
		<Blank title="Connect your alerts" testId="alerts-none">
			<p className="-mt-2 text-body text-text-2">
				Add as an Alertmanager webhook
			</p>
			<div className="pool flex w-full flex-col gap-1 px-4 py-3 text-left">
				<Row
					label="Webhook"
					value={url}
					copy={url}
					copyLabel="Copy URL"
					testId="alerts-copy-url"
				/>
				{token && (
					<Row
						label="Token"
						value={maskToken(token.token)}
						copy={token.token}
						copyLabel="Copy token"
						testId="alerts-copy-token"
					/>
				)}
			</div>
			<Link
				to="/settings"
				search={{ tab: "alert-intake" }}
				className="inline-flex min-h-6 items-center text-body text-text-2 hover:text-text-1 hover:underline"
				data-testid="alerts-add-source"
			>
				Or pull from a source
			</Link>
		</Blank>
	);
}

function Row({
	label,
	value,
	copy,
	copyLabel,
	testId,
}: {
	label: string;
	value: string;
	copy: string;
	copyLabel: string;
	testId: string;
}) {
	return (
		<div className="flex min-h-9 items-center gap-3">
			<span className="w-16 shrink-0 text-meta text-text-3">{label}</span>
			<Mono className="min-w-0 flex-1 break-all text-text-1">{value}</Mono>
			<CopyButton
				value={copy}
				label={copyLabel}
				variant="text"
				testId={testId}
			/>
		</div>
	);
}
