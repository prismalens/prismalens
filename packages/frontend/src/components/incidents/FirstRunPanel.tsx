// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessStatus } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/shared/CopyButton";
import { Mono } from "@/components/shared/Mono";
import { Button } from "@/components/ui/button";
import { useConnections, useHarnesses, useSetupStatus } from "@/lib/api/hooks";
import {
	maskToken,
	useLastDelivery,
	useWebhookToken,
	webhookUrl,
} from "@/lib/api/hooks/use-webhooks-orpc";

/**
 * The four steps between a fresh install and a useful run (study-v3 §3.1,
 * adversarial v2 finding 18). Steps 1 and 2 are two ways to the same thing,
 * so either one being done counts both.
 */
export function useSetupProgress() {
	const { data: setup } = useSetupStatus();
	const { data: delivery } = useLastDelivery();
	const { data: alertmanager } = useConnections({ templateId: "alertmanager" });
	const { data: prometheus } = useConnections({ templateId: "prometheus" });
	const { data: harnesses } = useHarnesses();
	const delivered = !!delivery;
	const pulling = (alertmanager?.length ?? 0) + (prometheus?.length ?? 0) > 0;
	const alertsIn = delivered || pulling;
	const agent = harnesses?.harnesses.find(
		(h) => h.id === harnesses.selection.harness && h.installed,
	);
	// Done only once the agent answered a check, not merely found (#673 w45).
	const ready = agent?.checked?.outcome === "answers-acp";
	const steps = {
		webhook: delivered,
		pull: pulling,
		agent: ready,
		code: !!setup?.steps.codeLocation,
	};
	return {
		loaded: !!setup && !!harnesses,
		steps,
		agent,
		harnesses: harnesses?.harnesses ?? [],
		done: (alertsIn ? 2 : 0) + (steps.agent ? 1 : 0) + (steps.code ? 1 : 0),
		alertsIn,
	};
}

/**
 * Above the columns until all four steps are done (study-v3 §3.1): how many,
 * what the first missing one costs, and the link that does it.
 */
export function SetupLine() {
	const p = useSetupProgress();
	if (!p.loaded || p.done === 4) return null;
	const [why, action] = !p.steps.agent
		? [
				"no coding agent on this machine, so no run can start.",
				<Link key="a" to="/settings" search={{ tab: "harness" }}>
					Set up an agent
				</Link>,
			]
		: !p.alertsIn
			? [
					"no alert source yet, so only incidents you create arrive.",
					<Link key="s" to="/settings" search={{ tab: "sources" }}>
						Add a source
					</Link>,
				]
			: [
					"no service names its code yet, so runs read nothing.",
					<Link key="v" to="/services" search={{ add: "1" }}>
						Add a service
					</Link>,
				];
	return (
		<p
			className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 pb-4 text-meta text-text-2 [&_a]:text-accent [&_a]:hover:underline"
			data-testid="setup-line"
		>
			<span>
				Setup, {p.done} of 4 done: {why}
			</span>
			{action}
		</p>
	);
}

function Step({
	n,
	done,
	title,
	children,
	action,
	keepAction,
	testId,
}: {
	n: number;
	done: boolean;
	title: string;
	children: ReactNode;
	action?: ReactNode;
	/** The webhook's URL and token stay copyable once it is in. */
	keepAction?: boolean;
	testId: string;
}) {
	return (
		<li
			className="flex items-start gap-3 py-3 max-sm:flex-wrap"
			data-testid={testId}
			data-done={done ? "" : undefined}
		>
			<span
				aria-hidden
				className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-meta text-text-2 tabular-nums"
			>
				{n}
			</span>
			<div className="min-w-0 flex-1">
				<p className="font-semibold text-text-1">{title}</p>
				<div className="mt-0.5 text-meta text-text-2">{children}</div>
			</div>
			<div className="flex shrink-0 flex-col items-stretch gap-1.5 max-sm:ml-8 max-sm:basis-full max-sm:flex-row max-sm:items-center">
				{done && (
					<span
						className="text-right text-body font-medium text-ok"
						data-testid="step-done"
					>
						Done
					</span>
				)}
				{(!done || keepAction) && action}
			</div>
		</li>
	);
}

/**
 * The first run (study-v3 §3.1): no columns, filters or counts, only the four
 * numbered steps with the system marking each Done, and New in the header as
 * the one way to make an incident by hand.
 */
export function FirstRunPanel() {
	const p = useSetupProgress();
	const { data: token } = useWebhookToken();
	const url = webhookUrl("prometheus");
	const looked = p.harnesses.map((h) => h.label);
	return (
		<div
			className="mx-auto w-full max-w-[34rem] px-4 pt-12 pb-12"
			data-testid="first-run"
		>
			<h2 className="text-display">Get the first alert in</h2>
			<p className="mt-1 text-body text-text-2">
				PrismaLens hands each alert to your coding agent and keeps the run, the
				evidence and the cause on the incident.
			</p>
			<ol className="pool mt-5 divide-y divide-hairline px-4 py-1">
				<Step
					n={1}
					done={p.steps.webhook}
					title="Point Alertmanager at this webhook"
					testId="first-run-step-1"
					keepAction
					action={
						<>
							<CopyButton
								value={url}
								label="Copy URL"
								testId="first-run-copy-url"
								className="sm:w-full"
							/>
							{token && (
								<CopyButton
									value={token.token}
									label="Copy token"
									testId="first-run-copy-token"
									className="sm:w-full"
								/>
							)}
						</>
					}
				>
					Add a receiver with this URL and the token as the bearer token.
					<Mono className="mt-1.5 block break-all text-text-1">{url}</Mono>
					{token ? (
						<Mono className="mt-1 block text-text-1">
							{maskToken(token.token)}
						</Mono>
					) : (
						<span className="mt-1 block">
							The token is under Settings, Alert sources on the machine
							PrismaLens runs on.
						</span>
					)}
				</Step>
				<Step
					n={2}
					done={p.steps.pull}
					title="Or pull what is firing now"
					testId="first-run-step-2"
					action={
						<Button asChild variant="secondary" size="sm">
							<Link to="/settings" search={{ tab: "sources" }}>
								Add a source
							</Link>
						</Button>
					}
				>
					Connect Alertmanager or Prometheus by URL; PrismaLens pulls the firing
					alerts and keeps pulling.
				</Step>
				<Step
					n={3}
					done={p.steps.agent}
					title="A coding agent on this machine"
					testId="first-run-step-3"
					action={
						<Button asChild variant="secondary" size="sm">
							<Link to="/settings" search={{ tab: "harness" }}>
								Agent
							</Link>
						</Button>
					}
				>
					{p.agent ? (
						<AgentReadiness agent={p.agent} />
					) : (
						<>
							PrismaLens looks for {looked.join(", ")} on PATH. Install one:
							{p.harnesses.slice(0, 3).map((h) => (
								<Mono
									key={h.id}
									className="mt-1 block break-all text-text-2"
									data-testid="first-run-install"
								>
									{h.install}
								</Mono>
							))}
						</>
					)}
				</Step>
				<Step
					n={4}
					done={p.steps.code}
					title="A service that names its code"
					testId="first-run-step-4"
					action={
						<Button asChild variant="secondary" size="sm">
							<Link to="/services" search={{ add: "1" }}>
								Add a service
							</Link>
						</Button>
					}
				>
					Give the service in the alert's <Mono>service</Mono> label a folder or
					a git URL; the run reads that code.
				</Step>
			</ol>
			<p className="mt-5 text-body text-text-2">
				No alert source yet?{" "}
				<span className="font-medium text-text-1">+ New incident</span> in the
				header creates one by hand and investigates it.
			</p>
		</div>
	);
}

/** Step 3's line: the boot sweep's check in its tone, or that none ran yet. */
function AgentReadiness({ agent }: { agent: HarnessStatus }) {
	const checked = agent.checked;
	if (checked?.outcome === "answers-acp")
		return (
			<>
				<span className="text-ok">{agent.label} ready</span>, {checked.detail}.
				Change it under Settings, Agent.
			</>
		);
	if (checked)
		return (
			<>
				<span
					className={
						checked.outcome === "sign-in-needed" ? "text-warn" : "text-danger"
					}
				>
					{agent.label}: {checked.detail}
				</span>
				. Check it again under Settings, Agent.
			</>
		);
	return (
		<>
			{agent.label} is on this machine and not checked yet. Check it under
			Settings, Agent.
		</>
	);
}
