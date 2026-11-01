// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Add agent (#907 decision 4): the one path to set an agent up. Three steps,
 * Agent, Sign-in and Config; it never drives an agent's own login (decision 7)
 * and never installs one (ADR 0003 §4).
 */

import type { HarnessId } from "@prismalens/config/harness";
import type { HarnessStatus } from "@prismalens/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { SquareTerminal } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import { InlineCode } from "@/components/shared/InlineCode";
import { Mono } from "@/components/shared/Mono";
import { RunInTerminalSent } from "@/components/terminal/RunInTerminal";
import { Button } from "@/components/ui/button";
import { CommandChip } from "@/components/ui/command-chip";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	useCheckHarness,
	useHarnesses,
	useHarnessSettings,
	useUpdateHarnessSettings,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";
import { AcpRegistrySearch } from "./AcpRegistrySearch";
import {
	EnvironmentRows,
	errorText,
	parseArgs,
	RuntimeFields,
} from "./AgentDetail";
import { apiKeyVars, EnvVarNotes } from "./agent-env";
import { StepList } from "./SourceConnectDialog";

const STEPS = ["Agent", "Sign-in", "Config"] as const;

/** The key a run takes without asking: the one the agent's own sign-in line names, else its only one. */
function fixedKey(agent: HarnessStatus): string | undefined {
	const keys = apiKeyVars(agent.id as HarnessId);
	const named = keys.filter((k) => agent.loginHint.includes(`\`${k}\``));
	if (named.length === 1) return named[0];
	return keys.length === 1 ? keys[0] : undefined;
}

/** A tile's neutral state word: no warning colour, since not set up is not a fault (#907). */
export function tileState(h: HarnessStatus): string {
	if (h.windowsOnlyPath) return "Windows install, can't run in WSL";
	if (!h.installed) return "Not installed";
	const outcome = h.checked?.outcome;
	if (outcome === "sign-in-needed") return "Sign-in needed";
	if (outcome === "no-answer" || outcome === "failed-to-start")
		return "Not responding";
	return "Ready";
}

/** The first command in a sign-in hint, to copy and run on the host; a variable name is not one. */
function loginCommand(hint: string): string | null {
	const spans = hint.split("`").filter((_, i) => i % 2 === 1);
	return spans.find((c) => !/^[A-Z][A-Z0-9_]*$/.test(c)) ?? null;
}

/** Waits for saves in flight (a field saved on blur) before the check runs. */
async function settled(isMutating: () => number): Promise<void> {
	for (let i = 0; i < 50 && isMutating() > 0; i++)
		await new Promise((r) => setTimeout(r, 100));
}

export function AddAgentDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { data } = useHarnesses();
	const settings = useHarnessSettings().data;
	const update = useUpdateHarnessSettings();
	const check = useCheckHarness();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const canEdit = settings?.canEditRuntime !== false;
	const [step, setStep] = useState(0);
	const [picked, setPicked] = useState<HarnessId | null>(null);
	const [command, setCommand] = useState("");
	const [args, setArgs] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [keyName, setKeyName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const agents = (data?.harnesses ?? []).filter((h) => h.id !== "local");
	const agent = data?.harnesses.find((h) => h.id === picked);
	const local = picked === "local";

	const reset = () => {
		setStep(0);
		setPicked(null);
		setCommand(settings?.localAgent?.command ?? "");
		setArgs("");
		setApiKey("");
		setKeyName("");
		setError(null);
		setResult(null);
	};
	const close = () => {
		onOpenChange(false);
		reset();
	};
	// Run in terminal closes the dialog and leaves focus on the staged line, not the trigger.
	const sentToTerminal = useRef(false);
	const closeForTerminal = () => {
		sentToTerminal.current = true;
		close();
	};
	const openPage = (id: HarnessId) => {
		close();
		void navigate({ to: "/settings", search: { tab: "agent", agent: id } });
	};

	const next = async () => {
		setError(null);
		if (step === 0) {
			if (!picked) return;
			if (local) {
				const parsed = parseArgs(args);
				if (typeof parsed === "string") return setError(parsed);
				if (!command.trim()) return setError("Set the command.");
				try {
					await update.mutateAsync({
						localAgent: { command: command.trim(), args: parsed },
					});
				} catch (e) {
					return setError(errorText(e));
				}
			}
			return setStep(1);
		}
		if (step === 1) {
			const name = (agent && fixedKey(agent)) || keyName;
			if (apiKey && !name) return setError("Pick which key this is.");
			if (apiKey && name && picked) {
				try {
					await update.mutateAsync({ env: { [picked]: { [name]: apiKey } } });
				} catch (e) {
					return setError(errorText(e));
				}
				setApiKey("");
			}
			return setStep(2);
		}
	};

	const checkAndAdd = async () => {
		if (!picked) return;
		setBusy(true);
		setError(null);
		try {
			await settled(() => queryClient.isMutating());
			const probe = await check.mutateAsync({ id: picked });
			if (probe.outcome === "answers-acp") return close();
			setResult(probe.detail);
		} catch (e) {
			setResult(errorText(e) ?? "The check did not run. Try it again.");
		} finally {
			setBusy(false);
		}
	};

	const pick = (id: HarnessId, h?: HarnessStatus) => {
		setError(null);
		// A ready agent needs no setting up: open its page (#907, operator's clarification).
		if (h && tileState(h) === "Ready") return openPage(id);
		setPicked(id);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				onOpenChange(o);
				if (!o) reset();
			}}
		>
			<DialogContent
				data-testid="add-agent-dialog"
				onCloseAutoFocus={(e) => {
					if (sentToTerminal.current) e.preventDefault();
					sentToTerminal.current = false;
				}}
			>
				<RunInTerminalSent.Provider value={closeForTerminal}>
					<DialogHeader>
						<DialogTitle>Add agent</DialogTitle>
						<DialogDescription>
							PrismaLens never installs an agent or signs it in for you.
						</DialogDescription>
						<StepList steps={STEPS} current={step} />
					</DialogHeader>

					{step === 0 && (
						<div className="grid min-w-0 gap-3">
							<div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
								{agents.map((h) => (
									<Tile
										key={h.id}
										on={picked === h.id}
										onClick={() => pick(h.id as HarnessId, h)}
										mark={<AgentMark id={h.id} className="size-5" />}
										label={h.label}
										state={tileState(h)}
										testId={`add-agent-tile-${h.id}`}
									/>
								))}
								<Tile
									on={local}
									onClick={() => pick("local")}
									mark={<SquareTerminal className="size-5 text-text-1" />}
									label="Local ACP command"
									state={settings?.localAgent ? "Set up" : ""}
									testId="add-agent-tile-local"
								/>
							</div>
							{local && (
								<div className="grid gap-2">
									<Input
										value={command}
										onChange={(e) => setCommand(e.target.value)}
										placeholder="/usr/local/bin/my-agent"
										aria-label="Command"
										readOnly={!canEdit}
										className="font-mono"
										data-testid="add-agent-command"
									/>
									<Input
										value={args}
										onChange={(e) => setArgs(e.target.value)}
										placeholder="Arguments, e.g. --acp"
										aria-label="Arguments"
										readOnly={!canEdit}
										className="font-mono"
										data-testid="add-agent-args"
									/>
									<p className="text-meta text-text-3">
										Any agent that speaks ACP on stdio, installed by you.
										Arguments are passed as written; no shell runs them.
									</p>
								</div>
							)}
							<AcpRegistrySearch />
						</div>
					)}

					{step === 1 && agent && (
						<div
							className="grid min-w-0 gap-3 text-body"
							data-testid="add-agent-signin"
						>
							{local ? (
								<p data-testid="add-agent-verdict">
									{agent.checked?.detail ?? "Not checked yet."}
								</p>
							) : !agent.installed ? (
								<>
									<p data-testid="add-agent-verdict">
										Not installed. Install it on this machine, or set its binary
										path in the next step.
									</p>
									<CommandChip
										command={agent.install}
										testId="add-agent-copy"
									/>
								</>
							) : (
								<>
									<p data-testid="add-agent-verdict">
										{tileState(agent)}
										{agent.checked ? `: ${agent.checked.detail}` : "."}
									</p>
									{loginCommand(agent.loginHint) ? (
										<p className="text-text-2">
											Sign in on this machine, then check again.
										</p>
									) : (
										<p className="text-text-2 [&_code]:bg-transparent! [&_code]:p-0!">
											<InlineCode text={agent.loginHint} />
										</p>
									)}
									<div className="flex items-center gap-2">
										{loginCommand(agent.loginHint) && (
											<CommandChip
												command={loginCommand(agent.loginHint) ?? ""}
												className="flex-1"
												testId="add-agent-copy"
											/>
										)}
										<Button
											variant="secondary"
											size="sm"
											disabled={check.isPending}
											onClick={() =>
												check.mutate({ id: agent.id as HarnessId })
											}
											data-testid="add-agent-check-again"
										>
											{check.isPending ? "Checking" : "Check again"}
										</Button>
									</div>
								</>
							)}
							{!local && canEdit && (
								<ApiKeyField
									agent={agent}
									value={apiKey}
									onChange={setApiKey}
									keyName={keyName}
									onKeyName={setKeyName}
								/>
							)}
						</div>
					)}

					{step === 2 && picked && (
						<div className="grid min-w-0 gap-4" data-testid="add-agent-config">
							<RuntimeFields id={picked} />
							<EnvironmentRows id={picked} />
							{result && (
								<p
									className="text-body text-text-2"
									data-testid="add-agent-result"
								>
									{result} Its settings are saved; it joins the list once it can
									run.
								</p>
							)}
						</div>
					)}

					{error && (
						<p className="text-meta text-danger" data-testid="add-agent-error">
							{error}
						</p>
					)}

					<DialogFooter>
						{step === 0 ? (
							<Button variant="secondary" onClick={close}>
								Cancel
							</Button>
						) : (
							<Button
								variant="secondary"
								onClick={() => {
									setResult(null);
									setStep(step - 1);
								}}
							>
								Back
							</Button>
						)}
						{step < 2 ? (
							<Button
								onClick={next}
								disabled={!picked || update.isPending}
								data-testid="add-agent-next"
							>
								Next
							</Button>
						) : result ? (
							<Button onClick={close} data-testid="add-agent-close">
								Close
							</Button>
						) : (
							<Button
								onClick={checkAndAdd}
								disabled={busy}
								data-testid="add-agent-check-and-add"
							>
								{busy ? "Checking" : "Check and add"}
							</Button>
						)}
					</DialogFooter>
				</RunInTerminalSent.Provider>
			</DialogContent>
		</Dialog>
	);
}

function Tile({
	on,
	onClick,
	mark,
	label,
	state,
	testId,
}: {
	on: boolean;
	onClick: () => void;
	mark: ReactNode;
	label: string;
	state: string;
	testId: string;
}) {
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={onClick}
			className={cn(
				"flex min-h-14 items-center gap-2.5 rounded-control bg-surface-2 px-3 text-left transition-colors duration-(--dur-instant) hover:bg-surface-3",
				on && "bg-surface-3 outline-2 outline-accent",
			)}
			data-testid={testId}
		>
			{mark}
			<span className="grid min-w-0 gap-0.5">
				<span className="truncate text-body font-medium text-text-1">
					{label}
				</span>
				{state && (
					<span
						className="truncate text-meta text-text-2"
						data-testid={`${testId}-state`}
					>
						{state}
					</span>
				)}
			</span>
		</button>
	);
}

/** One optional key, saved as an Environment row under the agent's documented name (#907 decision 7). */
function ApiKeyField({
	agent,
	value,
	onChange,
	keyName,
	onKeyName,
}: {
	agent: HarnessStatus;
	value: string;
	onChange: (v: string) => void;
	keyName: string;
	onKeyName: (v: string) => void;
}) {
	const id = agent.id as HarnessId;
	const fixed = fixedKey(agent);
	const options = apiKeyVars(id);
	if (options.length === 0) return null;
	const name = fixed ?? keyName;
	return (
		<div className="grid gap-1.5" data-testid="add-agent-api-key">
			<span className="text-meta text-text-2">Or an API key</span>
			<span className="flex items-center gap-2">
				{fixed ? (
					<Mono>{fixed}</Mono>
				) : (
					<Select value={keyName || undefined} onValueChange={onKeyName}>
						<SelectTrigger
							className="h-8 w-56 bg-surface-2"
							aria-label="Key name"
							data-testid="add-agent-key-name"
						>
							<SelectValue placeholder="Pick a key" />
						</SelectTrigger>
						<SelectContent>
							{options.map((k) => (
								<SelectItem key={k} value={k}>
									{k}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
				<Input
					type="password"
					autoComplete="off"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					aria-label="API key"
					className="h-8 w-56"
					data-testid="add-agent-key"
				/>
			</span>
			<span className="text-meta text-text-3">
				Stored encrypted and passed only to {agent.label}.
			</span>
			{name && (
				<EnvVarNotes agent={agent.label} id={id} name={name} state="set" />
			)}
		</div>
	);
}
