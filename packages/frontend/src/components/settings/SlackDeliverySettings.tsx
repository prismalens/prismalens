// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MutationError } from "@/components/shared/MutationError";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
		<SettingGroup title="Reports" testId="slack-delivery">
			<Pool>
				<SettingRow
					label="Post reports to Slack"
					description={
						configured
							? "A webhook is set; each finished or failed run posts its summary"
							: "No webhook set"
					}
					below={
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
							<Input
								aria-label={configured ? "Replace webhook URL" : "Webhook URL"}
								type="password"
								autoComplete="off"
								placeholder="https://hooks.slack.com/services/"
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								className="flex-1"
							/>
							<div className="flex items-center gap-2">
								<Button
									variant="secondary"
									disabled={!url.trim() || update.isPending}
									onClick={() => update.mutate({ slackWebhookUrl: url.trim() })}
								>
									Save
								</Button>
								{configured && (
									<Button
										variant="danger"
										disabled={update.isPending}
										onClick={() => update.mutate({ slackWebhookUrl: null })}
									>
										Remove
									</Button>
								)}
							</div>
						</div>
					}
				>
					<a
						className="text-meta text-accent hover:underline"
						href="https://api.slack.com/messaging/webhooks"
						target="_blank"
						rel="noreferrer"
					>
						Incoming webhooks
					</a>
				</SettingRow>
			</Pool>
			<MutationError error={update.error} className="mt-2" />
		</SettingGroup>
	);
}
