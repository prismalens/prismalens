// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MutationError } from "@/components/shared/MutationError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { orpc } from "@/lib/api/orpc-client";

/**
 * Slack incoming webhook for finished reports (#606, ADR 0008 §1). The URL is
 * write-only: the page only ever learns whether one is set.
 */
export function SlackDeliverySettings() {
	const queryClient = useQueryClient();
	const [url, setUrl] = useState("");
	const settings = useQuery(orpc.settings.delivery.get.queryOptions());
	const update = useMutation({
		...orpc.settings.delivery.update.mutationOptions(),
		onSuccess: (data) => {
			setUrl("");
			queryClient.setQueryData(orpc.settings.delivery.get.queryKey(), data);
		},
	});
	const configured = settings.data?.slackConfigured ?? false;

	return (
		<div className="mb-6 rounded-lg border bg-card p-6 space-y-3 text-sm">
			<h3 className="text-base font-semibold text-foreground">
				Post reports to Slack
			</h3>
			<p className="text-muted-foreground">
				Each finished or failed investigation posts its summary and root cause
				to a Slack channel through an{" "}
				<a
					className="text-primary hover:underline"
					href="https://api.slack.com/messaging/webhooks"
					target="_blank"
					rel="noreferrer"
				>
					incoming webhook
				</a>
				. A failed post shows on the incident timeline.{" "}
				{configured ? "A webhook is set." : "No webhook set."}
			</p>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-end">
				<div className="flex-1 space-y-1">
					<Label htmlFor="slack-webhook">
						{configured ? "Replace webhook URL" : "Webhook URL"}
					</Label>
					<Input
						id="slack-webhook"
						type="password"
						autoComplete="off"
						placeholder="https://hooks.slack.com/services/…"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
					/>
				</div>
				<Button
					disabled={!url.trim() || update.isPending}
					onClick={() => update.mutate({ slackWebhookUrl: url.trim() })}
				>
					Save
				</Button>
				{configured && (
					<Button
						variant="outline"
						disabled={update.isPending}
						onClick={() => update.mutate({ slackWebhookUrl: null })}
					>
						Remove
					</Button>
				)}
			</div>
			<MutationError error={update.error} />
		</div>
	);
}
