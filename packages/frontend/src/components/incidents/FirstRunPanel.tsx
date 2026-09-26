// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, CloudDownload, Copy } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { RunToolbar } from "@/components/agent/RunToolbar";
import { Mono } from "@/components/shared/Mono";
import { StateWord } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
	useConnections,
	useCreateIncident,
	useSetupStatus,
} from "@/lib/api/hooks";
import { alertKeys } from "@/lib/api/hooks/use-alerts-orpc";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";

function Row({
	done,
	title,
	children,
	action,
}: {
	done: boolean;
	title: string;
	children: ReactNode;
	action?: ReactNode;
}) {
	return (
		<div className="flex items-start gap-3 border-t py-3 first:border-t-0">
			<span
				className={
					done
						? "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-run-done/15 text-run-done"
						: "mt-1 h-2.5 w-2.5 shrink-0 translate-x-0.5 rounded-full border border-muted-foreground/50"
				}
				aria-hidden
			>
				{done && <Check className="h-3 w-3" />}
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-record font-medium">{title}</p>
				<div className="mt-0.5 text-record text-muted-foreground">
					{children}
				</div>
			</div>
			{action && <div className="shrink-0">{action}</div>}
		</div>
	);
}

function CopyUrl({ url, label }: { url: string; label: string }) {
	const { toast } = useToast();
	return (
		<button
			type="button"
			onClick={() => {
				navigator.clipboard?.writeText(url);
				toast({ title: `Copied the ${label} URL` });
			}}
			className="group inline-flex max-w-full items-center gap-1.5 rounded border bg-muted/40 px-2 py-0.5 text-left hover:bg-muted"
			title={`Copy ${url}`}
		>
			<Mono className="truncate text-meta">{url}</Mono>
			<Copy className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-foreground" />
		</button>
	);
}

/**
 * The starting state: no incidents exist yet. One panel with the three ways to
 * get the first one and what still blocks an investigation, each with its real
 * status. It replaces zero-value numbers and empty charts, which say nothing.
 */
export function FirstRunPanel() {
	const { toast } = useToast();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const create = useCreateIncident();
	const [title, setTitle] = useState("");
	const { data: setup } = useSetupStatus();
	const { data: alertmanager } = useConnections({ templateId: "alertmanager" });
	const { data: prometheus } = useConnections({ templateId: "prometheus" });
	const hasSource = (alertmanager?.length ?? 0) + (prometheus?.length ?? 0) > 0;
	const [origin, setOrigin] = useState<string | null>(null);
	useEffect(() => setOrigin(window.location.origin), []);

	const pull = useMutation({
		...orpc.alerts.pull.mutationOptions(),
		onSuccess: (r) => {
			toast({
				title: `Pulled ${r.received + r.caughtUp} alerts, ${r.processed} new`,
			});
			queryClient.invalidateQueries({ queryKey: alertKeys.all() });
			queryClient.invalidateQueries({ queryKey: incidentKeys.all() });
		},
		onError: (e) =>
			toast({
				title: "Pull failed",
				description: getErrorMessage(e),
				variant: "destructive",
			}),
	});

	const agentReady = !!setup?.steps.aiProvider;
	const codeLinked = !!setup?.steps.codeLocation;

	return (
		<div
			className="mx-auto flex h-full max-w-xl flex-col justify-center px-4 py-8 sm:px-6"
			data-testid="first-run"
		>
			<h2 className="text-center text-xl font-semibold tracking-tight">
				What is on fire?
			</h2>
			<form
				className="mt-4 rounded-lg border bg-card p-2"
				onSubmit={(e) => {
					e.preventDefault();
					const t = title.trim();
					if (!t) return;
					create.mutate(
						{ title: t },
						{
							onSuccess: (incident) =>
								navigate({
									to: "/incidents/$id",
									params: { id: incident.id },
									search: {},
								}),
							onError: (err) =>
								toast({
									title: "Could not create the incident",
									description: getErrorMessage(err),
									variant: "destructive",
								}),
						},
					);
				}}
			>
				<input
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="Describe the incident in one line and press Enter"
					aria-label="Incident title"
					className="h-9 w-full bg-transparent px-2 text-record outline-none placeholder:text-muted-foreground"
					data-testid="first-run-title"
				/>
				<div className="flex items-center justify-between gap-2 px-1 pt-1">
					<RunToolbar />
					<Button
						type="submit"
						size="sm"
						className="h-7"
						disabled={!title.trim() || create.isPending}
						data-testid="first-run-submit"
					>
						{create.isPending ? "Creating" : "Create"}
					</Button>
				</div>
			</form>
			<p className="mt-2 text-center text-meta text-muted-foreground">
				Or let an alert start one:
			</p>

			<div className="mt-5 rounded-md border px-4">
				<Row
					done={false}
					title="Point a monitor at the webhook"
					action={
						<Button asChild variant="outline" size="sm" className="h-7">
							<Link to="/settings" search={{ tab: "integrations" }}>
								Integrations
							</Link>
						</Button>
					}
				>
					{origin ? (
						<div className="flex flex-col gap-1">
							<span>
								Alertmanager:{" "}
								<CopyUrl
									url={`${origin}/api/webhooks/prometheus`}
									label="Alertmanager webhook"
								/>
							</span>
							<span>
								Anything else:{" "}
								<CopyUrl
									url={`${origin}/api/webhooks/generic`}
									label="generic webhook"
								/>
							</span>
						</div>
					) : (
						<span>The webhook URLs are under Settings → Integrations.</span>
					)}
				</Row>
				<Row
					done={hasSource}
					title="Pull what is firing now"
					action={
						hasSource ? (
							<Button
								size="sm"
								className="h-7"
								onClick={() => pull.mutate({})}
								disabled={pull.isPending}
								data-testid="first-run-pull"
							>
								<CloudDownload className="mr-1 h-3.5 w-3.5" />
								Pull
							</Button>
						) : (
							<Button asChild variant="outline" size="sm" className="h-7">
								<Link to="/settings" search={{ tab: "connections" }}>
									Connect
								</Link>
							</Button>
						)
					}
				>
					{hasSource
						? "An Alertmanager or Prometheus connection exists; pull its firing alerts."
						: "Connect Alertmanager or Prometheus and pull its firing alerts."}
				</Row>
			</div>

			<h3 className="mt-6 text-record font-medium">For the run to work</h3>
			<div className="mt-2 rounded-md border px-4">
				<Row
					done={agentReady}
					title="A coding agent on this machine"
					action={
						!agentReady && (
							<Button asChild variant="outline" size="sm" className="h-7">
								<Link to="/settings" search={{ tab: "harness" }}>
									Agent
								</Link>
							</Button>
						)
					}
				>
					{agentReady ? (
						<StateWord tone="done">ready</StateWord>
					) : (
						"None found on PATH. Install one and pick it under Settings → Agent."
					)}
				</Row>
				<Row
					done={codeLinked}
					title="A service that names its code"
					action={
						!codeLinked && (
							<Button asChild variant="outline" size="sm" className="h-7">
								<Link to="/services">Services</Link>
							</Button>
						)
					}
				>
					{codeLinked ? (
						<StateWord tone="done">linked</StateWord>
					) : (
						"Set a repository (a folder or a git URL) on a service; without one a run reads no code."
					)}
				</Row>
			</div>
		</div>
	);
}
