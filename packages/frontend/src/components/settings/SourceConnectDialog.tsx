// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	CREDENTIAL_KIND_FIELDS,
	CREDENTIAL_KIND_LABELS,
	GIT_HOST_SLUG,
	GIT_HOSTS,
	isGitProbeRepository,
	type ProbeReport,
	publicGitHostKind,
	type SourceCredentialKind,
	type SourceDraft,
} from "@prismalens/contracts/schemas";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Check } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { MutationError } from "@/components/shared/MutationError";
import { RingTick, useRingTick } from "@/components/shared/RingTick";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/hooks/use-toast";
import {
	useConnectSource,
	useTestSource,
} from "@/lib/api/hooks/use-sources-orpc";
import { validateFieldValues } from "@/lib/credential-schema";
import { cn } from "@/lib/utils";
import { DynamicCredentialForm } from "./DynamicCredentialForm";
import { Field } from "./Field";
import { KindIcon, StatePill, type Word } from "./source-words";

export interface SourceKindOption {
	id: string;
	label: string;
	description: string;
	/** The draft's `type`: a telemetry template, or the git host token. */
	type: string;
	url: string;
	git: boolean;
}

export const SOURCE_KINDS: readonly SourceKindOption[] = [
	{
		id: "prometheus",
		label: "Prometheus",
		description: "Firing alerts and target health over the incident window",
		type: "prometheus",
		url: "http://prometheus.internal:9090",
		git: false,
	},
	{
		id: "alertmanager",
		label: "Alertmanager",
		description: "Alerts that are active now",
		type: "alertmanager",
		url: "http://alertmanager.internal:9093",
		git: false,
	},
	{
		id: "loki",
		label: "Loki",
		description: "Log lines over the incident window",
		type: "loki",
		url: "http://loki.internal:3100",
		git: false,
	},
	...Object.entries(GIT_HOSTS).map(([id, { host, label }]) => ({
		id,
		label,
		description: "Browse repositories and connect a project",
		type: "git-host-token",
		url: `https://${host}`,
		git: true,
	})),
];

const TELEMETRY_KINDS: readonly SourceCredentialKind[] = [
	"bearer",
	"basic",
	"header",
	"mtls",
	"none",
];

/** The steps a flow walks, the finished ones ticked (#848). Add agent reads it too. */
export function StepList({
	steps,
	current,
}: {
	steps: readonly string[];
	current: number;
}) {
	return (
		<ol
			aria-label="Steps"
			className="mt-3 flex flex-wrap items-center gap-2 text-meta text-text-3"
			data-testid="step-list"
		>
			{steps.map((s, i) => {
				const done = i < current;
				const on = i === current;
				return (
					<li
						key={s}
						aria-current={on ? "step" : undefined}
						data-done={done ? "" : undefined}
						className={cn(
							"flex items-center gap-2",
							on && "font-semibold text-text-1",
							i > 0 && "before:h-px before:w-5 before:bg-text-3/50",
						)}
					>
						<span
							className={cn(
								"grid size-[18px] place-items-center rounded-full bg-surface-3 text-[11px] font-semibold text-text-2",
								on && "bg-accent-solid text-accent-fg",
								done && "bg-ok/18 text-ok",
							)}
						>
							{done ? <Check className="size-3" aria-label="Done" /> : i + 1}
						</span>
						{s}
					</li>
				);
			})}
		</ol>
	);
}

export function parseGitTarget(
	value: string,
	host: string,
	workspaceRequired: boolean,
): SourceDraft["gitTarget"] {
	const input = value.trim();
	if (input.length <= 2048 && isGitProbeRepository(input, host))
		return { repositoryUrl: input };
	if (workspaceRequired && input.length <= 100 && GIT_HOST_SLUG.test(input))
		return { workspace: input };
	return undefined;
}

export function GitProbeTarget({
	value,
	onChange,
	invalid,
	workspaceRequired,
}: {
	value: string;
	onChange: (value: string) => void;
	invalid?: boolean;
	workspaceRequired: boolean;
}) {
	const id = useId();
	return (
		<Field
			label="Test target"
			htmlFor={id}
			hint={
				workspaceRequired
					? "Enter a workspace to test browsing, or an HTTPS repository URL to test Git access."
					: "Leave blank to test browsing. Enter an HTTPS repository URL to test Git access instead."
			}
			error={
				invalid &&
				(workspaceRequired
					? "Enter a workspace slug or an HTTPS repository URL on this host."
					: "Enter an HTTPS repository URL on this host.")
			}
		>
			{(describedBy) => (
				<Input
					id={id}
					maxLength={2048}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					aria-describedby={describedBy}
					aria-invalid={invalid}
				/>
			)}
		</Field>
	);
}

function hostOfUrl(url: string): string | null {
	try {
		const u = new URL(url.trim());
		return (u.protocol === "http:" || u.protocol === "https:") && u.host
			? u.host
			: null;
	} catch {
		return null;
	}
}

/** Secrets PrismaLens cannot scrub reliably are refused before the probe (C7). */
function credentialProblem(
	fields: { name: string; label: string; sensitive?: boolean }[],
	values: Record<string, string>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const f of fields) {
		const v = values[f.name]?.trim() ?? "";
		if (f.name === "token" && /\s/.test(v))
			out[f.name] =
				"A token has no spaces or line breaks. Check what you pasted.";
		else if (v && f.sensitive && v.length < 4)
			out[f.name] =
				"Use at least 4 characters. PrismaLens cannot keep a shorter value out of the snapshot.";
	}
	return out;
}

/** What a finished probe reads as: the operator's words, never "Passed". */
export function probeWord(r: ProbeReport): Word {
	if (r.ok) return { text: "Connected", tone: "ok" };
	if (r.untested) return { text: "Not tested yet", tone: "neutral" };
	return { text: "Failed", tone: "danger" };
}

/** A save that answered without a connection stored nothing: the mark reads failed. */
export function saveFailed(m: {
	error: unknown;
	data: { connectionId?: string | null } | undefined;
}): boolean {
	return !!m.error || (!!m.data && !m.data.connectionId);
}

const STEPS = ["Kind", "Details", "Test and save"] as const;

/**
 * Add a source (#848): Kind, Details, then Test and save. Every check is a
 * read and nothing is saved before Save; "Save, not tested yet" keeps the
 * row at Not tested yet until a Test passes.
 */
export function SourceConnectDialog({
	open,
	onOpenChange,
	initialKind = "prometheus",
	initialUrl,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialKind?: string;
	initialUrl?: string;
}) {
	const [step, setStep] = useState(0);
	const [kindId, setKindId] = useState(initialKind);
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [gitTarget, setGitTarget] = useState("");
	const [credKind, setCredKind] = useState<SourceCredentialKind>("bearer");
	const [values, setValues] = useState<Record<string, string>>({});
	const [showErrors, setShowErrors] = useState(false);
	const [report, setReport] = useState<ProbeReport | null>(null);
	const test = useTestSource();
	const connect = useConnectSource();
	const saveRing = useRingTick(connect.isPending, saveFailed(connect));
	const { toast } = useToast();
	const nameId = useId();
	const urlId = useId();
	const credId = useId();
	const kind = SOURCE_KINDS.find((k) => k.id === kindId) ?? SOURCE_KINDS[0];
	const effectiveKind: SourceCredentialKind = kind.git ? "bearer" : credKind;
	const fields = CREDENTIAL_KIND_FIELDS[effectiveKind];

	// Reset only when the dialog opens; the mutations reset with it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset and initialKind are all it reads.
	useEffect(() => {
		if (!open) return;
		setStep(0);
		setKindId(initialKind);
		setName("");
		setUrl(
			initialUrl ??
				SOURCE_KINDS.find((option) => option.git && option.id === initialKind)
					?.url ??
				"",
		);
		setGitTarget("");
		setCredKind("bearer");
		setValues({});
		setShowErrors(false);
		setReport(null);
		test.reset();
		connect.reset();
	}, [open, initialKind, initialUrl]);

	const host = hostOfUrl(url);
	const hostKind = host ? publicGitHostKind(host) : undefined;
	const workspaceRequired =
		!!hostKind && GIT_HOSTS[hostKind].scope === "workspace";
	const target =
		kind.git && host
			? parseGitTarget(gitTarget, host, workspaceRequired)
			: undefined;
	const invalidTarget =
		kind.git && (workspaceRequired || !!gitTarget.trim()) && !target;
	const fieldErrors = {
		...validateFieldValues(fields, values),
		...credentialProblem(fields, values),
	};
	const draft = (saveUntested?: boolean): SourceDraft => ({
		type: kind.type,
		url: url.trim(),
		credential: { kind: effectiveKind, ...values },
		...(target ? { gitTarget: target } : {}),
		...(name.trim() ? { label: name.trim() } : {}),
		...(saveUntested ? { saveUntested: true } : {}),
	});

	const runTest = () => {
		setShowErrors(true);
		if (!host || invalidTarget || Object.keys(fieldErrors).length > 0) return;
		setReport(null);
		setStep(2);
		test.mutate(draft(), { onSuccess: setReport });
	};

	const save = (untested: boolean) =>
		connect.mutate(draft(untested), {
			onSuccess: (r) => {
				if (r.connectionId) {
					toast({ title: `Added ${name.trim() || host}` });
					onOpenChange(false);
				} else setReport(r.report);
			},
		});

	const word = report ? probeWord(report) : null;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="lg" data-testid="add-source-dialog">
				<DialogHeader>
					<DialogTitle>Add a source</DialogTitle>
					<DialogDescription>
						Every check is a read. Nothing is saved until you choose Save.
					</DialogDescription>
					<StepList steps={STEPS} current={step} />
				</DialogHeader>

				{step === 0 && (
					<div>
						<RadioGroupPrimitive.Root
							value={kindId}
							onValueChange={(id) => {
								setKindId(id);
								setUrl(
									SOURCE_KINDS.find((option) => option.git && option.id === id)
										?.url ?? "",
								);
								setGitTarget("");
							}}
							aria-label="Kind of source"
							className="grid gap-2 sm:grid-cols-2"
						>
							{SOURCE_KINDS.map((k) => (
								<RadioGroupPrimitive.Item
									key={k.id}
									value={k.id}
									className="flex min-h-14 items-center gap-3 rounded-pool bg-surface-1 px-3 py-2.5 text-left transition-colors duration-(--dur-instant) hover:bg-surface-3 data-[state=checked]:bg-accent/8 data-[state=checked]:outline-2 data-[state=checked]:-outline-offset-2 data-[state=checked]:outline-accent"
									data-testid={`source-kind-${k.id}`}
								>
									<KindIcon kind={k.id} />
									<span className="min-w-0">
										<strong className="block font-semibold">{k.label}</strong>
										<small className="block text-meta text-text-2">
											{k.description}
										</small>
									</span>
								</RadioGroupPrimitive.Item>
							))}
						</RadioGroupPrimitive.Root>
						<p className="mt-4 text-meta text-text-3">
							You paste the credential. PrismaLens stores it encrypted on this
							machine and never shows it again.
						</p>
					</div>
				)}

				{step === 1 && (
					<div className="space-y-4">
						<Field
							label="Name"
							htmlFor={nameId}
							hint="Shown in lists and in reports. Optional."
						>
							<Input
								id={nameId}
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder={`${kind.id}-prod`}
								data-testid="source-name"
							/>
						</Field>
						<Field
							label="URL"
							htmlFor={urlId}
							hint={
								host
									? `The credential is sent only to ${host}, and never through a redirect to another host.`
									: "Enter an http or https address."
							}
							error={
								showErrors &&
								!host &&
								"Enter an address that starts with http:// or https://"
							}
						>
							{(describedBy) => (
								<Input
									id={urlId}
									value={url}
									onChange={(e) => setUrl(e.target.value)}
									placeholder={kind.url}
									aria-describedby={describedBy}
									aria-invalid={showErrors && !host ? true : undefined}
									data-testid="source-url"
								/>
							)}
						</Field>
						{kind.git && (
							<GitProbeTarget
								value={gitTarget}
								onChange={setGitTarget}
								invalid={showErrors && invalidTarget}
								workspaceRequired={workspaceRequired}
							/>
						)}
						{!kind.git && (
							<Field label="Credential type" htmlFor={credId}>
								<Select
									value={credKind}
									onValueChange={(v) => {
										setCredKind(v as SourceCredentialKind);
										setValues({});
									}}
								>
									<SelectTrigger
										id={credId}
										className="w-full justify-between bg-surface-3"
										data-testid="source-credential-kind"
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{TELEMETRY_KINDS.map((k) => (
											<SelectItem key={k} value={k}>
												{k === "none"
													? "No credential"
													: CREDENTIAL_KIND_LABELS[k]}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
						)}
						{fields.length > 0 ? (
							<DynamicCredentialForm
								fields={fields.map((f) =>
									kind.git && f.name === "token" ? { ...f, label: "Token" } : f,
								)}
								values={values}
								onChange={setValues}
								showErrors={showErrors}
							/>
						) : (
							<p className="text-text-2">
								Requests will go without a credential. This is stored as a
								choice: a token in your environment will not be sent either.
							</p>
						)}
						{showErrors &&
							Object.entries(credentialProblem(fields, values)).map(
								([k, m]) => (
									<p key={k} role="alert" className="text-meta text-danger">
										{m}
									</p>
								),
							)}
					</div>
				)}

				{step === 2 && (
					<div aria-live="polite" data-testid="source-test-result">
						{test.isPending ? (
							<p className="flex items-center gap-2 text-text-2">
								<RingTick state="busy" className="size-4" />
								Testing {host}…
							</p>
						) : report && word ? (
							<div className="space-y-2">
								<StatePill word={word} testId="source-test-word" />
								{report.probes.map((p) => (
									<p
										key={p.id}
										className={cn(
											"text-body",
											p.ok ? "text-text-1" : "text-text-2",
										)}
									>
										{p.detail}
									</p>
								))}
								<p className="text-meta text-text-3">
									{kind.git
										? "The token only. Pin it to a repository afterwards."
										: "Address and credential only; no service uses it yet."}
								</p>
							</div>
						) : null}
						<MutationError error={test.error ?? connect.error} />
					</div>
				)}

				<DialogFooter>
					{step === 0 ? (
						<Button variant="text" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
					) : (
						<Button
							variant="text"
							onClick={() => {
								setReport(null);
								setStep(step - 1);
							}}
						>
							Back
						</Button>
					)}
					{step === 0 && (
						<Button variant="primary" onClick={() => setStep(1)}>
							Next
						</Button>
					)}
					{step === 1 && (
						<Button
							variant="primary"
							onClick={runTest}
							data-testid="source-test"
						>
							Test connection
						</Button>
					)}
					{step === 2 && report && !report.ok && !report.untested && (
						<Button
							variant="text"
							disabled={connect.isPending}
							onClick={() => save(true)}
							data-testid="source-save-untested"
						>
							Save, not tested yet
						</Button>
					)}
					{step === 2 && (
						<Button
							variant="primary"
							disabled={
								!report || (!report.ok && !report.untested) || connect.isPending
							}
							onClick={() => save(!report?.ok)}
							data-testid="source-save"
						>
							{saveRing && <RingTick state={saveRing} />}
							{report?.untested ? "Save, not tested yet" : "Save source"}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
