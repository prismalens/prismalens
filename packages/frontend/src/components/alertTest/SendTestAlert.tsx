// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Block } from "@/components/kit/Block";
import { entryOf } from "@/components/kit/registry";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useRepositories } from "@/lib/api/hooks";
import {
	useSendTestAlert,
	webhookUrl,
} from "@/lib/api/hooks/use-webhooks-orpc";
import { useAppCommand } from "@/lib/app-commands";
import { getErrorMessage } from "@/lib/get-error-message";
import { alertTestCurl, genericCurl } from "./alertTest.blocks";

interface ProjectChoice {
	id: string;
	fullName: string;
	plain: boolean;
}

/**
 * Send a test alert: a high-severity sample through the generic webhook's own
 * path, then the incident it opened. With no `project` it offers a picker over
 * every project; the curl below it is what a real alert source sends.
 */
export function SendTestAlert({ project }: { project?: ProjectChoice }) {
	const navigate = useNavigate();
	const repos = useRepositories({ limit: 100, enabled: !project });
	const send = useSendTestAlert();
	const [picked, setPicked] = useState<string | null>(null);
	const all: ProjectChoice[] = project
		? [project]
		: (repos.data?.data ?? []).map((r) => ({
				id: r.id,
				fullName: r.fullName,
				plain: r.plain,
			}));
	// Git projects first: the picker defaults to one that can be investigated.
	const choices = [...all].sort((a, b) => Number(a.plain) - Number(b.plain));
	const chosen = choices.find((c) => c.id === picked) ?? choices[0];
	const sendNow = () => {
		if (!chosen || chosen.plain || send.isPending) return;
		send.mutate(
			{ serviceName: chosen.fullName },
			{
				onSuccess: (sent) => {
					if (sent.incidentId)
						void navigate({
							to: "/incidents/$id",
							params: { id: sent.incidentId },
						});
				},
			},
		);
	};
	// The palette runs it too, while this is mounted.
	useAppCommand("sendTestAlert", sendNow);
	const entry = entryOf("app.sendTestAlert", {
		facts: {
			is: {
				sendTestAlert: true,
				noProject: !chosen,
				gitless: !!chosen?.plain,
				sending: send.isPending,
			},
		},
	});
	const row = entry && !("separator" in entry) ? entry : null;
	const Icon = row?.icon;
	const curl = genericCurl(
		webhookUrl("generic"),
		chosen?.fullName ?? "my-service",
	);
	return (
		<div className="grid gap-2" data-testid="send-test-alert">
			<div className="flex flex-wrap items-center gap-2">
				{!project && choices.length > 1 && (
					<Select value={chosen?.id} onValueChange={setPicked}>
						<SelectTrigger
							aria-label="Project to send the test alert for"
							data-testid="test-alert-project"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{choices.map((c) => (
								<SelectItem key={c.id} value={c.id}>
									{c.fullName}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
				{!project && choices.length === 1 && chosen && (
					<span className="text-body text-text-2" data-testid="test-alert-one">
						{chosen.fullName}
					</span>
				)}
				{row && (
					<Button
						variant="secondary"
						size="sm"
						disabled={row.disabled}
						onClick={sendNow}
						data-testid="send-test-alert-button"
					>
						{Icon && <Icon />}
						{send.isPending ? "Sending…" : row.label}
					</Button>
				)}
			</div>
			{row?.why && (
				<p className="text-meta text-text-3" data-testid="send-test-alert-why">
					{row.why}
				</p>
			)}
			{send.error && (
				<p className="text-meta text-danger" role="alert">
					{getErrorMessage(send.error)}
				</p>
			)}
			<details className="group" data-testid="send-test-alert-curl">
				<summary className="cursor-pointer text-meta text-text-2">
					Send one from your own alert source
				</summary>
				<Block spec={alertTestCurl} data={{ text: curl }} className="mt-1.5">
					<code className="block pr-8 font-mono text-mono break-all whitespace-pre-wrap text-text-1">
						{curl}
					</code>
				</Block>
				<p className="mt-1 text-meta text-text-3">
					Replace <span className="font-mono">&lt;TOKEN&gt;</span> with the
					token above.
				</p>
			</details>
		</div>
	);
}
