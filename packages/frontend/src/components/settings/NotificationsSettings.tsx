// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { MutationError } from "@/components/shared/MutationError";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { orpc } from "@/lib/api/orpc-client";

/**
 * Settings, Notifications (#848): where findings go. Finished reports post
 * to a Slack incoming webhook (#606, ADR 0008 §1); the URL is write-only, so
 * the page only ever learns whether one is set. Desktop notifications are #932.
 */
export function NotificationsSettings() {
	const queryClient = useQueryClient();
	const [url, setUrl] = useState("");
	const [replacing, setReplacing] = useState(false);
	const inputId = useId();
	const settings = useQuery(orpc.settings.delivery.get.queryOptions());
	const update = useMutation({
		...orpc.settings.delivery.update.mutationOptions(),
		onSuccess: (data) => {
			setUrl("");
			setReplacing(false);
			queryClient.setQueryData(orpc.settings.delivery.get.queryKey(), data);
		},
	});
	const configured = settings.data?.slackConfigured ?? false;
	const editing = !configured || replacing;

	return (
		<SettingGroup title="Reports" testId="slack-delivery">
			<Pool>
				<SettingRow
					label="Post reports to Slack"
					description={
						configured
							? "Each finished report goes to the channel of this webhook."
							: "Add the webhook of a Slack channel to post each finished report there."
					}
				>
					<Switch
						checked={configured}
						disabled={update.isPending || (!configured && !url.trim())}
						onCheckedChange={(on) =>
							on
								? update.mutate({ slackWebhookUrl: url.trim() })
								: update.mutate({ slackWebhookUrl: null })
						}
						aria-label="Post reports to Slack"
						data-testid="slack-switch"
					/>
				</SettingRow>
				<SettingRow
					label="Webhook URL"
					description={
						configured && !replacing ? (
							"Set; the address is never shown again"
						) : (
							<a
								className="text-accent hover:underline"
								href="https://api.slack.com/messaging/webhooks"
								target="_blank"
								rel="noreferrer"
							>
								Slack incoming webhooks
							</a>
						)
					}
					below={
						editing && (
							<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
								<Input
									id={inputId}
									aria-label={
										configured ? "Replace webhook URL" : "Webhook URL"
									}
									type="password"
									autoComplete="off"
									placeholder="https://hooks.slack.com/services/"
									value={url}
									onChange={(e) => setUrl(e.target.value)}
									className="flex-1"
								/>
								<Button
									variant="secondary"
									disabled={!url.trim() || update.isPending}
									onClick={() => update.mutate({ slackWebhookUrl: url.trim() })}
								>
									Save
								</Button>
							</div>
						)
					}
				>
					{configured && !replacing && (
						<Button
							variant="secondary"
							size="sm"
							onClick={() => setReplacing(true)}
							data-testid="slack-replace"
						>
							Replace
						</Button>
					)}
				</SettingRow>
			</Pool>
			<MutationError error={update.error} className="mt-2" />
		</SettingGroup>
	);
}
