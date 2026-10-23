// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One agent's page under Settings → Agent (#907): its models (show, star,
 * order, add), what it runs (binary path, config folder) and the variables
 * passed only to it. Runtime fields are the host's alone (decision 11).
 */

import type { HarnessId } from "@prismalens/config/harness";
import { type HarnessStatus, RUNTIME_HOST_ONLY } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowLeft, ArrowUp, Star, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { parse, quote } from "shell-quote";
import { AgentMark } from "@/components/agent/AgentMark";
import { modelName, useAgentChoice } from "@/components/agent/AgentPicker";
import { agentModels, move } from "@/components/agent/model-list";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Hint } from "@/components/shared/Hint";
import { Mono } from "@/components/shared/Mono";
import { Pool, Row } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { Loading } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
	useCheckHarness,
	useHarnesses,
	useHarnessSettings,
	useUpdateHarnessSettings,
} from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

/**
 * The version the last check read beside the tested one, so neither reads as the
 * other (#818 w5-31). Behind a shipped adapter, the agent CLI's own version.
 */
export function versionText(h: HarnessStatus): string | null {
	const cli = h.checked?.companionVersion ?? null;
	const ran = cli ?? h.checked?.version ?? null;
	const tested = cli
		? (h.tested?.companion ?? null)
		: (h.tested?.version ?? null);
	if (ran && tested) return `${ran}, tested with ${tested}`;
	// No CLI version on record for the test run, so name the adapter's (#831 w6-3).
	if (cli && h.tested) return `${cli}, adapter tested with ${h.tested.version}`;
	if (ran) return ran;
	const t = h.tested;
	return t ? `tested with ${t.companion ?? t.version}` : null;
}

/** The version note's hover line; behind a shipped adapter it names both the CLI and the adapter. */
export function testedHint(h: HarnessStatus): string {
	const t = h.tested;
	if (!t) return "No compatibility run yet";
	if (t.companion)
		return `PrismaLens was tested with ${h.label} ${t.companion} through its adapter ${t.version}`;
	if (h.checked?.companionVersion)
		return `PrismaLens was tested with its adapter ${t.version}`;
	return `PrismaLens was tested with ${t.version}`;
}

/** The server's refusal, as the words under the field. */
export function errorText(error: unknown): string | null {
	if (!error) return null;
	return error instanceof Error ? error.message : String(error);
}

export function AgentDetail({ id }: { id: HarnessId }) {
	const { data, isLoading } = useHarnesses();
	const agent = data?.harnesses.find((h) => h.id === id);
	const check = useCheckHarness();
	if (isLoading) return <Loading rows={5} />;
	return (
		<div data-testid="agent-detail">
			<Link
				to="/settings"
				search={{ tab: "harness" }}
				className="mb-4 inline-flex items-center gap-1.5 text-body text-text-2 hover:text-text-1"
				data-testid="agent-detail-back"
			>
				<ArrowLeft className="size-4" aria-hidden />
				Agent
			</Link>
			{!agent ? (
				<p className="text-body text-text-2">This agent is not known here.</p>
			) : (
				<>
					<div className="mb-6 flex min-w-0 items-center gap-3">
						<AgentMark id={agent.id} className="size-5" />
						<h2
							className="text-title font-semibold text-text-1"
							data-testid="agent-detail-title"
						>
							{agent.label}
						</h2>
						{versionText(agent) && (
							<Hint label={testedHint(agent)} meta={agent.tested?.date}>
								<span className="font-mono text-meta text-text-3">
									{versionText(agent)}
								</span>
							</Hint>
						)}
						<span className="flex-1" />
						<Button
							variant="secondary"
							size="sm"
							disabled={check.isPending}
							onClick={() => check.mutate({ id })}
							data-testid="agent-detail-check"
						>
							{check.isPending ? "Checking" : "Check"}
						</Button>
					</div>
					{agent.checked && agent.checked.outcome !== "answers-acp" && (
						<p
							className="mb-4 text-body text-text-2"
							data-testid="agent-detail-check-line"
						>
							{agent.checked.detail}
						</p>
					)}
					{agent.modelVia === "acp" && <ModelsSection agent={agent} />}
					<SettingGroup title="Runtime" testId="agent-runtime">
						<RuntimeFields id={id} />
					</SettingGroup>
					<SettingGroup title="Environment" testId="agent-environment">
						<EnvironmentRows id={id} />
					</SettingGroup>
				</>
			)}
		</div>
	);
}

/** Show or hide, star, reorder and add models; one PATCH per change (#907 decision 2). */
function ModelsSection({ agent }: { agent: HarnessStatus }) {
	const id = agent.id as HarnessId;
	const { customModels, hiddenModels, modelOrder, favourites } =
		useAgentChoice();
	const update = useUpdateHarnessSettings();
	const custom = customModels[id] ?? [];
	const hidden = hiddenModels[id] ?? [];
	const list = agentModels(agent, {
		custom,
		order: modelOrder[id],
		hidden,
	});
	const ids = list.map((m) => m.id);
	const shown = list.filter((m) => !m.hidden).length;
	const [draft, setDraft] = useState("");
	const [refusal, setRefusal] = useState<string | null>(null);
	const [removing, setRemoving] = useState<string | null>(null);
	const starred = (m: string) =>
		favourites.some((f) => f.harness === id && f.model === m);
	const setHidden = (next: string[]) =>
		update.mutate({ hiddenModels: { [id]: next.length ? next : null } });
	const add = (e: FormEvent) => {
		e.preventDefault();
		const model = draft.trim();
		if (!model) return;
		if (ids.includes(model)) {
			setRefusal(`${model} is already in the list.`);
			return;
		}
		setRefusal(null);
		update.mutate(
			{ customModels: { [id]: [...custom, model] } },
			{ onSuccess: () => setDraft("") },
		);
	};
	return (
		<SettingGroup
			title="Models"
			testId="agent-models"
			actions={
				<span className="flex items-center gap-3 text-meta text-text-3">
					<span data-testid="agent-models-count">
						{shown} of {list.length} shown
					</span>
					{list.length > 0 && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setHidden(shown > 0 ? ids : [])}
							data-testid="agent-models-toggle-all"
						>
							{shown > 0 ? "Hide all" : "Show all"}
						</Button>
					)}
				</span>
			}
			description="The Default row is always in the picker."
		>
			<Pool>
				{list.map((m, i) => {
					const name = modelName(agent, m.id) ?? m.id;
					return (
						<Row
							key={m.id}
							testId={`agent-model-${m.id}`}
							lead={
								<button
									type="button"
									aria-label={starred(m.id) ? `Unstar ${name}` : `Star ${name}`}
									aria-pressed={starred(m.id)}
									onClick={() =>
										update.mutate({
											favourites: starred(m.id)
												? favourites.filter(
														(f) => !(f.harness === id && f.model === m.id),
													)
												: [...favourites, { harness: id, model: m.id }],
										})
									}
									className="inline-flex size-6 items-center justify-center rounded-[4px] text-text-3 hover:bg-surface-4"
									data-testid="agent-model-star"
								>
									<Star
										className={cn(
											"size-3.5",
											starred(m.id) && "fill-warn text-warn",
										)}
									/>
								</button>
							}
							label={
								<span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
									{name}
									{m.custom && (
										<span className="text-meta font-normal text-text-3">
											Added by you
										</span>
									)}
								</span>
							}
							meta={<Mono>{m.id}</Mono>}
							trailing={
								<span className="flex items-center gap-1">
									{m.custom && (
										<Button
											variant="ghost"
											size="icon"
											aria-label={`Remove ${name}`}
											onClick={() => setRemoving(m.id)}
											data-testid="custom-model-remove"
										>
											<X className="size-3.5" />
										</Button>
									)}
									<Button
										variant="ghost"
										size="icon"
										aria-label={`Move ${name} up`}
										disabled={i === 0}
										onClick={() =>
											update.mutate({
												modelOrder: { [id]: move(ids, m.id, -1) },
											})
										}
									>
										<ArrowUp className="size-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										aria-label={`Move ${name} down`}
										disabled={i === list.length - 1}
										onClick={() =>
											update.mutate({
												modelOrder: { [id]: move(ids, m.id, 1) },
											})
										}
									>
										<ArrowDown className="size-3.5" />
									</Button>
									<Switch
										checked={!m.hidden}
										aria-label={`Show ${name} in the picker`}
										onCheckedChange={(on) =>
											setHidden(
												on
													? hidden.filter((h) => h !== m.id)
													: [...hidden, m.id],
											)
										}
										data-testid="agent-model-show"
									/>
								</span>
							}
						/>
					);
				})}
				<Row
					testId="agent-model-add"
					label="Add custom model"
					meta="A model your endpoint serves that the agent does not list. PrismaLens never checks it."
					stackOnPhone
					trailing={
						<form onSubmit={add} className="flex items-center gap-2">
							<Input
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								placeholder="Model id"
								aria-label={`Model id for ${agent.label}`}
								maxLength={200}
								className="h-7 w-44"
								data-testid="custom-model-input"
							/>
							<Button
								type="submit"
								variant="secondary"
								size="sm"
								disabled={!draft.trim() || update.isPending}
								data-testid="custom-model-add"
							>
								Add custom model
							</Button>
						</form>
					}
					below={
						refusal ? (
							<p
								className="text-meta text-danger"
								data-testid="custom-model-error"
							>
								{refusal}
							</p>
						) : undefined
					}
				/>
			</Pool>
			<DestructiveConfirm
				open={removing !== null}
				onOpenChange={(open) => !open && setRemoving(null)}
				title="Remove this custom model?"
				description={`${removing ?? ""} leaves the ${agent.label} picker. A run already set to it keeps it until you pick another.`}
				confirmLabel="Remove"
				isPending={update.isPending}
				error={update.error}
				onConfirm={() =>
					update.mutateAsync({
						customModels: { [id]: custom.filter((m) => m !== removing) },
					})
				}
			/>
		</SettingGroup>
	);
}

/** Whether this caller may change what agents run: false on a paired device. */
function useCanEditRuntime(): boolean {
	return useHarnessSettings().data?.canEditRuntime !== false;
}

/** A path field that saves on Enter or blur; empty sends null; the server's refusal shows under it. */
function PathField({
	label,
	description,
	value,
	placeholder,
	onSave,
	testId,
}: {
	label: string;
	description: string;
	value: string;
	placeholder?: string;
	onSave: (
		value: string | null,
		done: { onError: (e: unknown) => void; onSuccess: () => void },
	) => void;
	testId: string;
}) {
	const canEdit = useCanEditRuntime();
	const [draft, setDraft] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const text = draft ?? value;
	const save = () => {
		if (draft === null || draft.trim() === value) return;
		onSave(draft.trim() || null, {
			onError: (e) => setError(errorText(e)),
			onSuccess: () => {
				setError(null);
				setDraft(null);
			},
		});
	};
	return (
		<SettingRow
			label={label}
			description={
				<>
					{canEdit ? description : RUNTIME_HOST_ONLY}
					{error && (
						<span
							className="mt-1 block text-danger"
							data-testid={`${testId}-error`}
						>
							{error}
						</span>
					)}
				</>
			}
			testId={testId}
		>
			<Input
				value={text}
				readOnly={!canEdit}
				placeholder={placeholder}
				aria-label={label}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={save}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						save();
					}
				}}
				className="h-8 w-72 font-mono"
				data-testid={`${testId}-input`}
			/>
		</SettingRow>
	);
}

/** Arguments as one line, parsed with shell-quote; an operator or glob is refused. */
export function parseArgs(text: string): string[] | string {
	// `$NAME` stays as written: nothing here expands it, and no shell runs later.
	const tokens = parse(text, (key) => `$${key}`);
	if (tokens.some((t) => typeof t !== "string"))
		return "Arguments can't hold shell operators.";
	return tokens as string[];
}

/** Binary path and config directory; for the local agent, its command and arguments (#907 decision 8). */
export function RuntimeFields({ id }: { id: HarnessId }) {
	const { data } = useHarnesses();
	const settings = useHarnessSettings().data;
	const update = useUpdateHarnessSettings();
	const canEdit = useCanEditRuntime();
	const [removing, setRemoving] = useState(false);
	const agent = data?.harnesses.find((h) => h.id === id);
	if (!agent) return null;
	if (id === "local") {
		const local = settings?.localAgent;
		const saveLocal = (
			next: { command?: string; args?: string[] },
			done: { onError: (e: unknown) => void; onSuccess: () => void },
		) => {
			const command = next.command ?? local?.command;
			if (!command) return done.onError(new Error("Set the command first."));
			update.mutate(
				{ localAgent: { command, args: next.args ?? local?.args ?? [] } },
				done,
			);
		};
		return (
			<Pool>
				<PathField
					label="Command"
					description="The program that speaks ACP on stdio, as a full path."
					value={local?.command ?? ""}
					placeholder="/usr/local/bin/my-agent"
					testId="runtime-command"
					onSave={(v, done) =>
						v === null
							? done.onError(new Error("Use Remove local agent to clear it."))
							: saveLocal({ command: v }, done)
					}
				/>
				<PathField
					label="Arguments"
					description="Passed to the command as written; no shell runs them."
					value={local ? quote(local.args) : ""}
					placeholder="--acp"
					testId="runtime-args"
					onSave={(v, done) => {
						const args = parseArgs(v ?? "");
						if (typeof args === "string") return done.onError(new Error(args));
						saveLocal({ args }, done);
					}}
				/>
				{local && canEdit && (
					<SettingRow
						label="Remove local agent"
						description="Runs can't pick it until you add it again."
						testId="runtime-remove-local"
					>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => setRemoving(true)}
						>
							Remove local agent
						</Button>
						<DestructiveConfirm
							open={removing}
							onOpenChange={setRemoving}
							title="Remove the local agent?"
							description="Its command and arguments are forgotten. Its variables stay until you remove them."
							confirmLabel="Remove"
							isPending={update.isPending}
							error={update.error}
							onConfirm={() => update.mutateAsync({ localAgent: null })}
						/>
					</SettingRow>
				)}
			</Pool>
		);
	}
	const binary = agent.cliBinary || agent.binary;
	return (
		<Pool>
			<PathField
				label="Binary path"
				description={`Where ${binary} is. Empty uses PATH.`}
				value={settings?.binaryPaths?.[id] ?? ""}
				placeholder={`/usr/local/bin/${binary}`}
				testId="runtime-binary"
				onSave={(v, done) => update.mutate({ binaryPaths: { [id]: v } }, done)}
			/>
			{agent.configDir && (
				<PathField
					label="Config directory"
					description={`Sets ${agent.configDir.envKey}. Empty uses ${agent.configDir.shownDefault}.`}
					value={settings?.configDirs?.[id] ?? ""}
					testId="runtime-config-dir"
					onSave={(v, done) => update.mutate({ configDirs: { [id]: v } }, done)}
				/>
			)}
		</Pool>
	);
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** Variables passed only to this agent: names listed, values never read back (#907 decision 9). */
export function EnvironmentRows({ id }: { id: HarnessId }) {
	const { data } = useHarnesses();
	const settings = useHarnessSettings().data;
	const update = useUpdateHarnessSettings();
	const canEdit = useCanEditRuntime();
	const [name, setName] = useState("");
	const [value, setValue] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [removing, setRemoving] = useState<string | null>(null);
	const label = data?.harnesses.find((h) => h.id === id)?.label ?? id;
	const names = settings?.envNames?.[id] ?? [];
	const add = (e: FormEvent) => {
		e.preventDefault();
		const key = name.trim();
		if (!ENV_NAME.test(key)) {
			setError("Use letters, digits and _, not starting with a digit.");
			return;
		}
		update.mutate(
			{ env: { [id]: { [key]: value } } },
			{
				onError: (err) => setError(errorText(err)),
				onSuccess: () => {
					setError(null);
					setName("");
					setValue("");
				},
			},
		);
	};
	return (
		<>
			<p className="mb-3 text-meta text-text-3" data-testid="env-intro">
				{canEdit
					? `Passed only to ${label}. Values are stored encrypted and never shown again; your own environment still applies, and a name set here wins.`
					: RUNTIME_HOST_ONLY}
			</p>
			<Pool>
				{names.map((n) => (
					<Row
						key={n}
						testId={`env-row-${n}`}
						label={<Mono>{n}</Mono>}
						meta="••••••"
						trailing={
							canEdit && (
								<Button
									variant="secondary"
									size="sm"
									onClick={() => setRemoving(n)}
									data-testid="env-remove"
								>
									Remove
								</Button>
							)
						}
					/>
				))}
				{canEdit && (
					<Row
						testId="env-add"
						label="Add variable"
						meta="Adding a name that is already set replaces its value."
						stackOnPhone
						trailing={
							<form onSubmit={add} className="flex items-center gap-2">
								<Input
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder="NAME"
									aria-label="Variable name"
									autoComplete="off"
									className="h-7 w-44 font-mono"
									data-testid="env-name"
								/>
								<Input
									type="password"
									autoComplete="off"
									value={value}
									onChange={(e) => setValue(e.target.value)}
									placeholder="value"
									aria-label="Variable value"
									className="h-7 w-44"
									data-testid="env-value"
								/>
								<Button
									type="submit"
									variant="secondary"
									size="sm"
									disabled={!name.trim() || update.isPending}
									data-testid="env-add-button"
								>
									Add variable
								</Button>
							</form>
						}
						below={
							error ? (
								<p className="text-meta text-danger" data-testid="env-error">
									{error}
								</p>
							) : undefined
						}
					/>
				)}
			</Pool>
			<DestructiveConfirm
				open={removing !== null}
				onOpenChange={(open) => !open && setRemoving(null)}
				title="Remove this variable?"
				description={`${removing ?? ""} is no longer passed to ${label}. Your own environment still applies.`}
				confirmLabel="Remove"
				isPending={update.isPending}
				error={update.error}
				onConfirm={() =>
					update.mutateAsync({ env: { [id]: { [removing ?? ""]: null } } })
				}
			/>
		</>
	);
}
