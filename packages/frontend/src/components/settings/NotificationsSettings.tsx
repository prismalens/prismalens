// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Help } from "@/components/kit/Help";
import { settingOf } from "@/components/kit/registry";
import { MutationError } from "@/components/shared/MutationError";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { orpc } from "@/lib/api/orpc-client";
import { NotifyChoices } from "./NotifyChoices";

/**
 * Settings, Notifications (#848): where findings go. Finished reports post
 * to a Slack incoming webhook (#606, ADR 0008 §1); the URL is write-only, so
 * the page only ever learns whether one is set. Threads notify through
 * `NotifyChoices` (#1101 category 4).
 */
export function NotificationsSettings() {
	const queryClient = useQueryClient();
	const [url, setUrl] = useState("");
	const [replacing, setReplacing] = useState(false);
	const inputId = useId();
	const switchId = useId();
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
		<>
			<NotifyChoices />
			<SettingGroup title="Reports" testId="slack-delivery">
				<Pool>
					<SettingRow
						label={
							<span className="flex items-center gap-1">
								<label htmlFor={switchId}>Post reports to Slack</label>
								<Help
									about="Post reports to Slack"
									text="Each finished report goes to the channel of this webhook."
								/>
							</span>
						}
					>
						<Switch
							id={switchId}
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
								"Set, never shown again"
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
										onClick={() =>
											update.mutate({ slackWebhookUrl: url.trim() })
										}
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
			<SettingGroup
				title={settingOf("notifications.limits").label}
				testId={settingOf("notifications.limits").anchor}
			>
				<ul
					className="flex list-disc flex-col gap-1.5 pl-5 text-body text-text-2"
					data-testid="notify-limits-list"
				>
					{NOTIFY_FACTS.map((fact) => (
						<li key={fact}>{fact}</li>
					))}
				</ul>
			</SettingGroup>
		</>
	);
}

/** What the page promises, stated once (#1101 cat 4 item 8): the browser's limits and what goes out. */
const NOTIFY_FACTS = [
	"Notifications and sound come from this browser tab and this instance; no outside service carries them.",
	"A closed tab cannot notify. Browsers allow notifications only over HTTPS or on localhost, and an iPhone only after Add to Home Screen.",
	"Phone push is opt-in under Devices. A push carries ids only; the phone fetches the words from this instance.",
	"Only a report you choose to post to Slack leaves this machine, sent to the webhook above.",
] as const;
