// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MutationError } from "@/components/shared/MutationError";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { orpc } from "@/lib/api/orpc-client";

/** What is sent, word for word the same in the consent line and in Settings (#602). */
export const TELEMETRY_DISCLOSURE =
	"Anonymous usage data: a random install id, the PrismaLens version, OS, and events (setup completed, service added, investigation started and how it ended, which coding agent). No alert text, repo names, reports or hostnames.";

export function useTelemetrySettings() {
	const queryClient = useQueryClient();
	const query = useQuery(orpc.settings.telemetry.get.queryOptions());
	const update = useMutation({
		...orpc.settings.telemetry.update.mutationOptions(),
		onSuccess: (data) =>
			queryClient.setQueryData(orpc.settings.telemetry.get.queryKey(), data),
	});
	return { query, update };
}

/** The one-time question on /incidents, until the owner answers (#602). */
export function TelemetryConsent() {
	const { query, update } = useTelemetrySettings();
	if (!query.data || query.data.decided || query.data.forcedOff) return null;

	return (
		<div
			className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
			data-testid="telemetry-consent"
		>
			<p className="text-muted-foreground">
				Help improve PrismaLens? {TELEMETRY_DISCLOSURE} Change it any time in
				Settings.
			</p>
			<div className="flex shrink-0 items-center gap-2">
				{update.isError && (
					<span className="text-destructive">Could not save — try again.</span>
				)}
				<Button
					variant="outline"
					size="sm"
					disabled={update.isPending}
					onClick={() => update.mutate({ enabled: false })}
				>
					No thanks
				</Button>
				<Button
					size="sm"
					disabled={update.isPending}
					onClick={() => update.mutate({ enabled: true })}
				>
					Share usage data
				</Button>
			</div>
		</div>
	);
}

export function TelemetrySettings() {
	const { query, update } = useTelemetrySettings();
	const settings = query.data;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Usage data</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4 text-sm">
				<p className="text-muted-foreground">{TELEMETRY_DISCLOSURE}</p>
				<div className="flex items-center gap-2">
					<Checkbox
						id="telemetry-enabled"
						checked={settings?.enabled ?? false}
						disabled={!settings || settings.forcedOff || update.isPending}
						onCheckedChange={(checked) =>
							update.mutate({ enabled: checked === true })
						}
					/>
					<Label htmlFor="telemetry-enabled">Share anonymous usage data</Label>
				</div>
				{settings?.forcedOff && (
					<p className="text-muted-foreground">
						Off for this process: <code>PRISMALENS_TELEMETRY=off</code> or{" "}
						<code>pl up --telemetry=off</code> is set.
					</p>
				)}
				<MutationError error={update.error} />
			</CardContent>
		</Card>
	);
}
