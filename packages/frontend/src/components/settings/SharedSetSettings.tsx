// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The PrismaLens set (#1180 §3.3): instructions and MCP servers PrismaLens sends to the
 * agents the person picked, beside each agent's own config. A share is approved as shown.
 */
import {
	type ApproveSharedServerInput,
	type HarnessStatus,
	RUNTIME_HOST_ONLY,
	type SharedMcpDef,
	type SharedMcpServerView,
	type SharedServerPreview,
	type SharedSet,
	type SharedSource,
} from "@prismalens/contracts";
import { useEffect, useId, useState } from "react";
import { settingOf } from "@/components/kit/registry";
import { DestructiveConfirm } from "@/components/shared/DestructiveConfirm";
import { Mono } from "@/components/shared/Mono";
import { Pool, Row } from "@/components/shared/Row";
import { SettingGroup } from "@/components/shared/SettingRow";
import { Loading, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useHarnesses, useHarnessSettings } from "@/lib/api/hooks";
import {
	useApproveSharedServer,
	usePreviewSharedServer,
	useRemoveSharedServer,
	useRevealSharedServerRow,
	useSetSharedMembership,
	useSharedSet,
	useSharedSources,
	useUpdateSharedSet,
} from "@/lib/api/hooks/use-agent-setup-orpc";
import { errorText, parseArgs } from "./AgentDetail";
import { StatePill } from "./source-words";

export const INSTRUCTIONS_HINT = "Sent to agents and kept with each thread.";
export const SHARED_AS_SHOWN = "Shared as shown to every agent you pick.";
export const STARTS_IN_FOLDER =
	"Starts in each thread's folder and may read config there.";
export const DOTS = "••••••";

export interface AgentChoice {
	id: string;
	label: string;
}

export type SourceRow = SharedSource & {
	transport: "stdio" | "http" | "sse" | null;
};

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A config key as a shared server's name, delivered as `pl-<name>`. */
export function serverName(key: string): string {
	return key
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+/, "")
		.slice(0, 40);
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** `stdio · node · 2 arguments` or `http · mcp.example.com`. */
export function serverLine(s: SharedMcpServerView): string {
	return s.transport === "stdio"
		? [s.transport, s.command, plural(s.argCount, "argument")]
				.filter(Boolean)
				.join(" · ")
		: [s.transport, s.host].filter(Boolean).join(" · ");
}

/** Origin and path only; what parsing took off, in the words the form names it. */
export function cleanUrl(
	text: string,
): { url: string; removed: SharedServerPreview["removed"] } | null {
	let u: URL;
	try {
		u = new URL(text.trim());
	} catch {
		return null;
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") return null;
	const removed: SharedServerPreview["removed"] = [];
	if (u.username || u.password) removed.push("sign-in");
	if (u.search) removed.push("query");
	if (u.hash) removed.push("fragment");
	return { url: `${u.origin}${u.pathname === "/" ? "" : u.pathname}`, removed };
}

const removedLine = (removed: SharedServerPreview["removed"]) =>
	`Removed from the URL: ${removed.join(", ")}`;

// ---------------------------------------------------------------- share form

/** One argument or the URL path: dots until revealed, then Confirm, or a typed Secret. */
interface RowDraft {
	shown: string | null;
	confirmed: boolean;
	secret: string | null;
}
const BLANK: RowDraft = { shown: null, confirmed: false, secret: null };
const rowReady = (r: RowDraft) => r.confirmed || !!r.secret;
const argName = (i: number) => `ARG_${i + 1}`;

function Recipients({
	agents,
	picked,
	onChange,
}: {
	agents: readonly AgentChoice[];
	picked: readonly string[];
	onChange: (next: string[]) => void;
}) {
	const id = useId();
	return (
		<fieldset className="flex flex-col gap-2" data-testid="share-recipients">
			<legend className="mb-1 text-body font-medium text-text-2">Agents</legend>
			{agents.map((a) => (
				<label
					key={a.id}
					htmlFor={`${id}-${a.id}`}
					className="flex items-center gap-2 text-body text-text-1"
				>
					<Checkbox
						id={`${id}-${a.id}`}
						checked={picked.includes(a.id)}
						onCheckedChange={(on) =>
							onChange(
								on === true
									? [...picked, a.id]
									: picked.filter((p) => p !== a.id),
							)
						}
						data-testid={`share-recipient-${a.id}`}
					/>
					{a.label}
				</label>
			))}
		</fieldset>
	);
}

function NameField({
	value,
	onChange,
}: {
	value: string;
	onChange: (v: string) => void;
}) {
	const id = useId();
	return (
		<div className="flex flex-col gap-1 text-body text-text-2">
			<label htmlFor={id}>Name</label>
			<Input
				id={id}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				maxLength={40}
				className="h-8"
				data-testid="share-name"
			/>
			{value && !NAME.test(value) && (
				<span className="text-meta text-danger" data-testid="share-name-error">
					Lowercase letters, digits and -, up to 40.
				</span>
			)}
		</div>
	);
}

function MaskedRow({
	label,
	draft,
	allowSecret,
	onReveal,
	onChange,
	testId,
}: {
	label: string;
	draft: RowDraft;
	allowSecret: boolean;
	onReveal: () => void;
	onChange: (next: RowDraft) => void;
	testId: string;
}) {
	const secret = draft.secret !== null;
	return (
		<Row
			testId={testId}
			label={label}
			meta={
				secret ? undefined : (
					<Mono data-testid={`${testId}-value`}>{draft.shown ?? DOTS}</Mono>
				)
			}
			stackOnPhone
			trailing={
				<span className="flex items-center gap-1">
					{!secret && (
						<Button
							variant="ghost"
							size="sm"
							disabled={draft.shown !== null}
							onClick={onReveal}
							data-testid={`${testId}-reveal`}
						>
							Reveal
						</Button>
					)}
					{!secret && (
						<Button
							variant="secondary"
							size="sm"
							aria-pressed={draft.confirmed}
							disabled={draft.shown === null}
							onClick={() =>
								onChange({ ...draft, confirmed: !draft.confirmed })
							}
							data-testid={`${testId}-confirm`}
						>
							Confirm
						</Button>
					)}
					{allowSecret && (
						<Button
							variant="ghost"
							size="sm"
							aria-pressed={secret}
							onClick={() =>
								onChange(
									secret
										? BLANK
										: { shown: null, confirmed: false, secret: "" },
								)
							}
							data-testid={`${testId}-secret`}
						>
							Secret
						</Button>
					)}
				</span>
			}
			below={
				secret ? (
					<Input
						type="password"
						autoComplete="off"
						value={draft.secret ?? ""}
						onChange={(e) => onChange({ ...draft, secret: e.target.value })}
						placeholder="Secret"
						aria-label={`Secret for ${label.toLowerCase()}`}
						className="h-8"
						data-testid={`${testId}-secret-input`}
					/>
				) : undefined
			}
		/>
	);
}

function ValueRows({
	names,
	values,
	onChange,
}: {
	names: readonly string[];
	values: Record<string, string>;
	onChange: (next: Record<string, string>) => void;
}) {
	if (!names.length) return null;
	return (
		<Pool>
			{names.map((n) => (
				<Row
					key={n}
					testId={`share-value-${n}`}
					label={<Mono>{n}</Mono>}
					meta="Never read from the agent's file."
					stackOnPhone
					trailing={
						<Input
							type="password"
							autoComplete="off"
							value={values[n] ?? ""}
							onChange={(e) => onChange({ ...values, [n]: e.target.value })}
							placeholder="Secret"
							aria-label={`Value for ${n}`}
							className="h-7 w-44"
						/>
					}
				/>
			))}
		</Pool>
	);
}

function Footer({
	stdio,
	ready,
	pending,
	error,
	onApprove,
}: {
	stdio: boolean;
	ready: boolean;
	pending: boolean;
	error: unknown;
	onApprove: () => void;
}) {
	return (
		<>
			<div className="flex flex-col gap-1 text-meta text-text-3">
				<p>{SHARED_AS_SHOWN}</p>
				{stdio && <p>{STARTS_IN_FOLDER}</p>}
			</div>
			{!!error && (
				<p className="text-meta text-danger" data-testid="share-error">
					{errorText(error)}
				</p>
			)}
			<DialogFooter>
				<Button
					disabled={!ready || pending}
					onClick={onApprove}
					data-testid="share-approve"
				>
					{pending ? "Approving" : "Approve"}
				</Button>
			</DialogFooter>
		</>
	);
}

const nonEmpty = (values: Record<string, string>) =>
	Object.fromEntries(Object.entries(values).filter(([, v]) => v));

/** A server pre-filled from an agent's config: every row starts as dots. */
function PreviewServer({
	preview,
	agents,
	onReveal,
	onApprove,
	pending,
	error,
}: {
	preview: SharedServerPreview;
	agents: readonly AgentChoice[];
	onReveal: (row: number | "path") => Promise<string>;
	onApprove: (input: ApproveSharedServerInput) => void;
	pending: boolean;
	error: unknown;
}) {
	const [name, setName] = useState(serverName(preview.source.key));
	const [args, setArgs] = useState<RowDraft[]>(preview.args.map(() => BLANK));
	const [path, setPath] = useState<RowDraft>(BLANK);
	const [values, setValues] = useState<Record<string, string>>({});
	const [recipients, setRecipients] = useState(agents.map((a) => a.id));
	const stdio = preview.transport === "stdio";
	const ready =
		NAME.test(name) &&
		recipients.length > 0 &&
		args.every(rowReady) &&
		(stdio || !preview.hasPath || path.confirmed);
	const reveal = (row: number | "path") =>
		void onReveal(row).then((shown) =>
			row === "path"
				? setPath((p) => ({ ...p, shown }))
				: setArgs((a) => a.map((r, i) => (i === row ? { ...r, shown } : r))),
		);
	const approve = () => {
		const def: SharedMcpDef = stdio
			? {
					type: "stdio",
					command: preview.command ?? "",
					args: args.map((r, i) =>
						r.confirmed && r.shown !== null ? r.shown : { value: argName(i) },
					),
					env: preview.env,
				}
			: {
					type: "http",
					url: `${preview.origin ?? ""}${path.confirmed ? (path.shown ?? "") : ""}`,
					query: [],
					headers: preview.headers,
				};
		const secrets = Object.fromEntries(
			args.flatMap((r, i) =>
				!r.confirmed && r.secret ? [[argName(i), r.secret]] : [],
			),
		);
		onApprove({
			name,
			def,
			values: { ...nonEmpty(values), ...secrets },
			recipients,
			from: {
				agent: preview.source.agent,
				path: preview.source.path,
				key: preview.source.key,
			},
		});
	};
	return (
		<>
			<NameField value={name} onChange={setName} />
			<Pool>
				<Row
					label={stdio ? "Command" : "Origin"}
					meta={<Mono>{(stdio ? preview.command : preview.origin) ?? ""}</Mono>}
					testId="share-command"
				/>
				{args.map((r, i) => (
					<MaskedRow
						key={argName(i)}
						label={`Argument ${i + 1}`}
						draft={r}
						allowSecret
						onReveal={() => reveal(i)}
						onChange={(next) =>
							setArgs((a) => a.map((x, j) => (j === i ? next : x)))
						}
						testId={`share-arg-${i}`}
					/>
				))}
				{!stdio && preview.hasPath && (
					<MaskedRow
						label="URL path"
						draft={path}
						allowSecret={false}
						onReveal={() => reveal("path")}
						onChange={setPath}
						testId="share-path"
					/>
				)}
			</Pool>
			{preview.removed.length > 0 && (
				<p className="text-meta text-text-3" data-testid="share-removed">
					{removedLine(preview.removed)}
				</p>
			)}
			<ValueRows
				names={stdio ? preview.env : preview.headers}
				values={values}
				onChange={setValues}
			/>
			<Recipients
				agents={agents}
				picked={recipients}
				onChange={setRecipients}
			/>
			<Footer
				stdio={stdio}
				ready={ready}
				pending={pending}
				error={error}
				onApprove={approve}
			/>
		</>
	);
}

/** A server the person types: what they type is what is shared. */
function TypedServer({
	agents,
	onApprove,
	pending,
	error,
}: {
	agents: readonly AgentChoice[];
	onApprove: (input: ApproveSharedServerInput) => void;
	pending: boolean;
	error: unknown;
}) {
	const [name, setName] = useState("");
	const [transport, setTransport] = useState<"stdio" | "http">("stdio");
	const [command, setCommand] = useState("");
	const [argText, setArgText] = useState("");
	const [urlText, setUrlText] = useState("");
	const [recipients, setRecipients] = useState(agents.map((a) => a.id));
	const stdio = transport === "stdio";
	const args = parseArgs(argText);
	const url = cleanUrl(urlText);
	const ready =
		NAME.test(name) &&
		recipients.length > 0 &&
		(stdio ? !!command.trim() && typeof args !== "string" : !!url);
	const approve = () =>
		onApprove({
			name,
			def: stdio
				? {
						type: "stdio",
						command: command.trim(),
						args: typeof args === "string" ? [] : args,
						env: [],
					}
				: { type: "http", url: url?.url ?? "", query: [], headers: [] },
			values: {},
			recipients,
			from: null,
		});
	return (
		<>
			<NameField value={name} onChange={setName} />
			<Select
				value={transport}
				onValueChange={(v) => setTransport(v === "http" ? "http" : "stdio")}
			>
				<SelectTrigger aria-label="Transport" data-testid="share-transport">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="stdio">stdio</SelectItem>
					<SelectItem value="http">http</SelectItem>
				</SelectContent>
			</Select>
			{stdio ? (
				<>
					<Input
						value={command}
						onChange={(e) => setCommand(e.target.value)}
						placeholder="Command, as a full path"
						aria-label="Command"
						className="h-8"
						data-testid="share-typed-command"
					/>
					<Input
						value={argText}
						onChange={(e) => setArgText(e.target.value)}
						placeholder="Arguments"
						aria-label="Arguments"
						className="h-8"
						data-testid="share-typed-args"
					/>
					{typeof args === "string" && (
						<p className="text-meta text-danger">{args}</p>
					)}
				</>
			) : (
				<>
					<Input
						value={urlText}
						onChange={(e) => setUrlText(e.target.value)}
						placeholder="https://"
						aria-label="URL"
						className="h-8"
						data-testid="share-typed-url"
					/>
					{url && url.removed.length > 0 && (
						<p className="text-meta text-text-3" data-testid="share-removed">
							{removedLine(url.removed)}
						</p>
					)}
				</>
			)}
			<Recipients
				agents={agents}
				picked={recipients}
				onChange={setRecipients}
			/>
			<Footer
				stdio={stdio}
				ready={ready}
				pending={pending}
				error={error}
				onApprove={approve}
			/>
		</>
	);
}

const TYPED = "typed";
const sourceKey = (s: SharedSource) => `${s.agent}\n${s.path}\n${s.key}`;

/** Pick a source from an agent's config, or type one; then approve it as shown. */
export function ShareServerForm({
	sources,
	agents,
	labelOf,
	initial,
	preview,
	previewing,
	onPick,
	onReveal,
	onApprove,
	pending,
	error,
}: {
	sources: readonly SourceRow[];
	agents: readonly AgentChoice[];
	labelOf: (id: string) => string;
	/** A source to start from, as Copy again names it. */
	initial?: SharedSource;
	preview: SharedServerPreview | null;
	previewing: boolean;
	onPick: (source: SharedSource) => void;
	onReveal: (row: number | "path") => Promise<string>;
	onApprove: (input: ApproveSharedServerInput) => void;
	pending: boolean;
	error: unknown;
}) {
	const [picked, setPicked] = useState<string>(
		initial ? sourceKey(initial) : sources.length ? "" : TYPED,
	);
	// Copy again opens on its source, so its preview starts with the dialog.
	useEffect(() => {
		if (initial) onPick(initial);
	}, [initial, onPick]);
	const pick = (key: string) => {
		setPicked(key);
		const source = sources.find((s) => sourceKey(s) === key);
		if (source) onPick(source);
	};
	const shown =
		preview && picked !== TYPED && sourceKey(preview.source) === picked
			? preview
			: null;
	return (
		<div className="flex flex-col gap-4" data-testid="share-form">
			<Select value={picked} onValueChange={pick}>
				<SelectTrigger aria-label="Share from" data-testid="share-source">
					<SelectValue placeholder="Pick a server" />
				</SelectTrigger>
				<SelectContent>
					{sources.map((s) => (
						<SelectItem key={sourceKey(s)} value={sourceKey(s)}>
							{`${s.key}, from ${labelOf(s.agent)}`}
						</SelectItem>
					))}
					<SelectItem value={TYPED}>Type one</SelectItem>
				</SelectContent>
			</Select>
			{picked === TYPED ? (
				<TypedServer
					agents={agents}
					onApprove={onApprove}
					pending={pending}
					error={error}
				/>
			) : shown ? (
				<PreviewServer
					key={picked}
					preview={shown}
					agents={agents}
					onReveal={onReveal}
					onApprove={onApprove}
					pending={pending}
					error={error}
				/>
			) : (
				previewing && <Loading rows={2} />
			)}
		</div>
	);
}

const installedAgents = (hs: readonly HarnessStatus[]): AgentChoice[] =>
	hs.filter((h) => h.installed).map((h) => ({ id: h.id, label: h.label }));

/** The share dialog; Settings and the first-run offer open it (§3.2). */
export function ShareServerDialog({
	open,
	onOpenChange,
	initial,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initial?: SharedSource;
	onSaved?: () => void;
}) {
	const harnesses = useHarnesses().data?.harnesses ?? [];
	const sources = useSharedSources(open).data ?? [];
	const preview = usePreviewSharedServer();
	const reveal = useRevealSharedServerRow();
	const approve = useApproveSharedServer();
	const labelOf = (id: string) =>
		harnesses.find((h) => h.id === id)?.label ?? id;
	const source = preview.data?.source;
	const { mutate: previewMutate } = preview;
	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				onOpenChange(o);
				if (!o) {
					preview.reset();
					approve.reset();
				}
			}}
		>
			<DialogContent size="lg" data-testid="share-dialog">
				<DialogHeader>
					<DialogTitle>Share a server</DialogTitle>
					<DialogDescription>
						Env and header values are typed here, never read from a file.
					</DialogDescription>
				</DialogHeader>
				{open && (
					<ShareServerForm
						sources={sources}
						agents={installedAgents(harnesses)}
						labelOf={labelOf}
						initial={initial}
						preview={preview.data ?? null}
						previewing={preview.isPending}
						onPick={previewMutate}
						onReveal={async (row) =>
							source
								? (await reveal.mutateAsync({ source, row })).value
								: Promise.reject(new Error("Pick a server first."))
						}
						onApprove={(input) =>
							approve.mutate(input, {
								onSuccess: () => {
									onSaved?.();
									onOpenChange(false);
								},
							})
						}
						pending={approve.isPending}
						error={approve.error ?? preview.error ?? reveal.error}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------- the page section

function ServerRow({
	server,
	labelOf,
	canEdit,
	onCopyAgain,
	onRemove,
}: {
	server: SharedMcpServerView;
	labelOf: (id: string) => string;
	canEdit: boolean;
	onCopyAgain: () => void;
	onRemove: () => void;
}) {
	const to = server.recipients.length
		? `To ${server.recipients.map(labelOf).join(", ")}`
		: "No agents";
	return (
		<Row
			testId={`shared-server-${server.name}`}
			label={<Mono>{server.name}</Mono>}
			meta={
				<>
					<span data-testid="shared-server-line">{serverLine(server)}</span>
					<span className="block" data-testid="shared-server-recipients">
						{to}
					</span>
				</>
			}
			stackOnPhone
			trailing={
				<span className="flex flex-wrap items-center gap-2">
					{server.missingValues.length > 0 && (
						<StatePill
							word={{ text: "Needs values", tone: "warn" }}
							testId="shared-server-needs-values"
						/>
					)}
					{server.changedInSource && (
						<>
							<StatePill
								word={{
									text: `Changed in ${labelOf(server.fromAgent ?? "")}`,
									tone: "warn",
								}}
								testId="shared-server-changed"
							/>
							{canEdit && (
								<Button
									variant="secondary"
									size="sm"
									onClick={onCopyAgain}
									data-testid="shared-server-copy-again"
								>
									Copy again
								</Button>
							)}
						</>
					)}
					{canEdit && (
						<Button
							variant="ghost"
							size="sm"
							onClick={onRemove}
							data-testid="shared-server-remove"
						>
							Remove
						</Button>
					)}
				</span>
			}
		/>
	);
}

/** The set as read, with its controls; the page section and the gallery draw it. */
export function SharedSetView({
	set,
	agents,
	labelOf,
	canEdit,
	saving,
	onSaveInstructions,
	onShare,
	onCopyAgain,
	onRemove,
	onMember,
}: {
	set: SharedSet;
	agents: readonly AgentChoice[];
	labelOf: (id: string) => string;
	canEdit: boolean;
	saving: boolean;
	onSaveInstructions: (text: string) => void;
	onShare: () => void;
	onCopyAgain: (server: SharedMcpServerView) => void;
	onRemove: (name: string) => void;
	onMember: (id: string, member: boolean) => void;
}) {
	const s = settingOf("agent.sharedSet");
	const [draft, setDraft] = useState<string | null>(null);
	const text = draft ?? set.instructions;
	const member = (id: string) =>
		set.instructionsFor.includes(id) ||
		set.servers.some((v) => v.recipients.includes(id));
	return (
		<SettingGroup
			title={s.label}
			description={s.sentence}
			testId={s.anchor}
			actions={
				<Button
					variant="secondary"
					size="sm"
					disabled={!canEdit}
					onClick={onShare}
					data-testid="shared-set-share"
				>
					Share a server
				</Button>
			}
		>
			{!canEdit && (
				<p className="mb-2 text-meta text-text-3">{RUNTIME_HOST_ONLY}</p>
			)}
			<Pool>
				<Row
					label="Instructions"
					meta={INSTRUCTIONS_HINT}
					testId="shared-set-instructions"
					below={
						<div className="flex flex-col items-end gap-2">
							<Textarea
								value={text}
								onChange={(e) => setDraft(e.target.value)}
								maxLength={32768}
								aria-label="Instructions"
								data-testid="shared-set-instructions-input"
							/>
							<Button
								variant="secondary"
								size="sm"
								disabled={
									draft === null || draft === set.instructions || saving
								}
								onClick={() => {
									onSaveInstructions(text);
									setDraft(null);
								}}
								data-testid="shared-set-instructions-save"
							>
								Save
							</Button>
						</div>
					}
				/>
			</Pool>
			<h4 className="mt-5 mb-2 text-body font-medium text-text-2">Servers</h4>
			{set.servers.length === 0 ? (
				<p
					className="text-meta text-text-3"
					data-testid="shared-set-no-servers"
				>
					No shared servers yet
				</p>
			) : (
				<Pool>
					{set.servers.map((server) => (
						<ServerRow
							key={server.name}
							server={server}
							labelOf={labelOf}
							canEdit={canEdit}
							onCopyAgain={() => onCopyAgain(server)}
							onRemove={() => onRemove(server.name)}
						/>
					))}
				</Pool>
			)}
			<h4 className="mt-5 mb-2 text-body font-medium text-text-2">Agents</h4>
			<Pool>
				{agents.map((a) => (
					<Row
						key={a.id}
						testId={`shared-set-agent-${a.id}`}
						label={a.label}
						trailing={
							<Switch
								checked={member(a.id)}
								disabled={!canEdit}
								aria-label={`${settingOf("agent.useSharedSet").label}: ${a.label}`}
								onCheckedChange={(on) => onMember(a.id, on)}
								data-testid={`shared-set-agent-${a.id}-switch`}
							/>
						}
					/>
				))}
			</Pool>
		</SettingGroup>
	);
}

/** Settings → Agents → PrismaLens set. */
export function SharedSetSettings() {
	const set = useSharedSet();
	const harnesses = useHarnesses().data?.harnesses ?? [];
	const canEdit = useHarnessSettings().data?.canEditRuntime !== false;
	const update = useUpdateSharedSet();
	const remove = useRemoveSharedServer();
	const membership = useSetSharedMembership();
	const sources = useSharedSources(
		set.data?.servers.some((v) => v.changedInSource) ?? false,
	);
	const [sharing, setSharing] = useState<{ initial?: SharedSource } | null>(
		null,
	);
	const [removing, setRemoving] = useState<string | null>(null);
	const labelOf = (id: string) =>
		harnesses.find((h) => h.id === id)?.label ?? id;
	if (set.isError)
		return (
			<Problem
				text="Could not read the PrismaLens set"
				onRetry={() => void set.refetch()}
			/>
		);
	if (!set.data) return <Loading rows={3} />;
	const copyAgain = (server: SharedMcpServerView) => {
		const from = (sources.data ?? []).filter(
			(s) => s.agent === server.fromAgent,
		);
		const source =
			from.find((s) => serverName(s.key) === server.name) ?? from[0];
		setSharing({ initial: source });
	};
	return (
		<>
			<SharedSetView
				set={set.data}
				agents={installedAgents(harnesses)}
				labelOf={labelOf}
				canEdit={canEdit}
				saving={update.isPending}
				onSaveInstructions={(instructions) => update.mutate({ instructions })}
				onShare={() => setSharing({})}
				onCopyAgain={copyAgain}
				onRemove={setRemoving}
				onMember={(id, member) => membership.mutate({ id, member })}
			/>
			<ShareServerDialog
				open={sharing !== null}
				onOpenChange={(o) => !o && setSharing(null)}
				initial={sharing?.initial}
			/>
			<DestructiveConfirm
				open={removing !== null}
				onOpenChange={(o) => !o && setRemoving(null)}
				title="Remove this shared server?"
				description={`${removing ?? ""} stops reaching every agent, and its values are deleted.`}
				confirmLabel="Remove"
				isPending={remove.isPending}
				error={remove.error}
				onConfirm={() => remove.mutateAsync({ name: removing ?? "" })}
			/>
		</>
	);
}
