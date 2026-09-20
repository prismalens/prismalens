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

/**
 * The one-sentence version, on the consent line where the owner first meets the
 * question. Settings carries the full disclosure below it (#602).
 */
export const TELEMETRY_SUMMARY =
	"Anonymous usage data: which features get used and whether investigations finish — counts and categories only, never the content of an alert, a repository or a report.";

/** Everything sent, in the order it is worth reading. */
export const TELEMETRY_SENT = [
	"An install id: a random identifier created once for this workspace.",
	"The PrismaLens version, how it was launched, the operating system, CPU architecture and Node major version.",
	"One event per milestone, carrying fixed categories only: setup finished; a service gained a repository (local folder or git); an integration was configured (which vendor); the first alert this install ever received (which source); an investigation started (which coding agent, and whether it was asked for by hand or by an alert); an investigation ended (its outcome, how long it took as one of four ranges, and a category for the failure); a report was viewed; a report was exported (Markdown or Slack); an incident was closed.",
];

/** What cannot be sent, because no property in the taxonomy could carry it. */
export const TELEMETRY_NEVER_SENT =
	"Never sent: alert text or payloads, repository names or URLs, prompts, anything a model wrote, API keys, hostnames, workspace paths, email addresses, names, error messages, or the time any individual alert arrived. Every property is a fixed category, a range or a yes/no — there is no free-text field anywhere in what is sent.";

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
				Help improve PrismaLens? {TELEMETRY_SUMMARY} Nothing is sent unless you
				say yes, and Settings → Usage data changes the answer at any time.
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
				<p className="text-muted-foreground">{TELEMETRY_SUMMARY}</p>
				<div className="space-y-2 text-muted-foreground">
					<p className="font-medium text-foreground">What is sent</p>
					<ul className="list-disc space-y-1 pl-5">
						{TELEMETRY_SENT.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</div>
				<p className="text-muted-foreground">{TELEMETRY_NEVER_SENT}</p>
				<div className="space-y-2 text-muted-foreground">
					<p className="font-medium text-foreground">
						The install id, and your consent
					</p>
					<p>
						The install id is random, but it is the same on every event this
						install sends — which is what makes it possible to count installs
						rather than events. That makes it pseudonymous rather than
						anonymous, so it is treated as personal data, and your consent — the
						checkbox below — is the only basis on which any of it is collected.
						It is not joined to an account or a profile, and the IP address a
						request arrives from is discarded rather than stored or resolved to
						a location.
					</p>
					<p>
						Events are kept for 12 months and then deleted. Clearing the
						checkbox withdraws consent and stops collection from that moment. A
						factory reset deletes the id with everything else, so a reset
						install starts over as a new, unrelated one.
					</p>
				</div>
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
