// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type ConnectStep,
	CREDENTIAL_KIND_FIELDS,
	CREDENTIAL_KIND_LABELS,
	connectSteps,
	type DetectedSource,
	type McpPreview,
	type ProbeReport,
	type SourceCredentialKind,
	type SourceDraft,
	type SourceTypeDescriptor,
} from "@prismalens/contracts/schemas";
import { useEffect, useId, useState } from "react";
import { Mono } from "@/components/shared/Mono";
import { MutationError } from "@/components/shared/MutationError";
import { StateWord } from "@/components/shared/StateWord";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
	useMcpPreview,
	useOAuthStart,
	useRetestSource,
	useSourcesOverview,
	useTestSource,
} from "@/lib/api/hooks/use-sources-orpc";
import { validateFieldValues } from "@/lib/credential-schema";
import { DynamicCredentialForm } from "./DynamicCredentialForm";
import { Field } from "./Field";
import {
	callbackUrl,
	Disclosure,
	disclosureFor,
	SignInPanel,
	type SignInValues,
} from "./SignInPanel";

const SIGN_IN_KINDS = new Set<SourceCredentialKind>(["oauth", "mcp-oauth"]);
const SIGN_IN_WAIT_MS = 10 * 60_000;

function hostOf(url: string): string | null {
	try {
		return new URL(url).host || null;
	} catch {
		return null;
	}
}

/**
 * The one connect flow (#848): the vendor was picked on its category's row; here the
 * auth form from the descriptor, test and discover on submit, a discovered choice when
 * the type asks for one, and confirm. `connectSteps` is the step list the count test reads.
 */
export function ConnectSourceDialog({
	type,
	detected,
	open,
	onOpenChange,
}: {
	type: SourceTypeDescriptor;
	detected?: DetectedSource;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const steps = connectSteps(type);
	const [step, setStep] = useState<ConnectStep>("auth");
	const [url, setUrl] = useState("");
	const [kind, setKind] = useState<SourceCredentialKind>(
		type.credentialKinds[0] ?? "none",
	);
	const [values, setValues] = useState<Record<string, string>>({});
	const [useDetected, setUseDetected] = useState(false);
	const [serviceLabel, setServiceLabel] = useState<string | null>(null);
	const [report, setReport] = useState<ProbeReport | null>(null);
	const [showErrors, setShowErrors] = useState(false);
	const test = useTestSource();
	const connect = useConnectSource();
	const oauthStart = useOAuthStart();
	const preview = useMcpPreview();
	const retest = useRetestSource();
	const overview = useSourcesOverview();
	const [signIn, setSignIn] = useState<SignInValues>({
		clientId: "",
		clientSecret: "",
		scopes: "",
	});
	const [waitingSince, setWaitingSince] = useState<{
		at: number;
		known: Set<string>;
	} | null>(null);
	const [savedId, setSavedId] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [tools, setTools] = useState<McpPreview | null>(null);
	const mcp = type.id === "mcp-server";
	const nameId = useId();
	const descriptionId = useId();
	const { toast } = useToast();
	const urlId = useId();
	const kindId = useId();
	const labelsId = useId();
	const detectedToken =
		detected && type.detect.tokenEnv?.includes(detected.env);

	useEffect(() => {
		if (!open) return;
		setStep("auth");
		setUrl(detected?.url ?? type.url.default ?? "");
		setKind(type.credentialKinds[0] ?? "none");
		setValues({});
		setUseDetected(false);
		setServiceLabel(null);
		setReport(null);
		setShowErrors(false);
		setSignIn({ clientId: "", clientSecret: "", scopes: "" });
		setWaitingSince(null);
		setSavedId(null);
		setName("");
		setDescription("");
		setTools(null);
		test.reset();
		connect.reset();
		oauthStart.reset();
	}, [open, type, detected, test.reset, connect.reset, oauthStart.reset]);

	// The sign-in finishes in another tab; the new connection shows up in the overview.
	const refetch = overview.refetch;
	useEffect(() => {
		if (!waitingSince) return;
		const timer = setInterval(() => {
			if (Date.now() - waitingSince.at > SIGN_IN_WAIT_MS) setWaitingSince(null);
			else void refetch();
		}, 2000);
		return () => clearInterval(timer);
	}, [waitingSince, refetch]);
	const retestNew = retest.mutate;
	useEffect(() => {
		if (!waitingSince) return;
		const added = overview.data?.categories
			.flatMap((c) => c.sources)
			.find((s) => s.kind === type.id && !waitingSince.known.has(s.id));
		if (!added) return;
		setWaitingSince(null);
		setSavedId(added.id);
		retestNew(
			{ id: added.id },
			{
				onSuccess: (r) => {
					setReport(r);
					setStep("confirm");
				},
			},
		);
	}, [overview.data, waitingSince, type.id, retestNew]);

	const fields = CREDENTIAL_KIND_FIELDS[kind];
	const host = hostOf(url);
	const draft = (detectedUse: boolean): SourceDraft => ({
		type: type.id,
		url: url.trim(),
		...(detectedUse
			? { useDetected: true }
			: { credential: { kind, ...values } }),
		...(serviceLabel ? { serviceLabel } : {}),
		...(mcp && name.trim() ? { name: name.trim() } : {}),
		...(mcp && description.trim() ? { description: description.trim() } : {}),
	});
	const signingIn = SIGN_IN_KINDS.has(kind);

	const startSignIn = () => {
		setShowErrors(true);
		if (!host) return;
		const known = new Set(
			(overview.data?.categories ?? []).flatMap((c) =>
				c.sources.map((s) => s.id),
			),
		);
		const cb = callbackUrl();
		oauthStart.mutate(
			{
				draft: {
					...draft(false),
					credential: {
						...(signIn.clientId.trim()
							? { clientId: signIn.clientId.trim() }
							: {}),
						...(signIn.clientSecret
							? { clientSecret: signIn.clientSecret }
							: {}),
					},
					...(signIn.scopes.trim()
						? { scopes: signIn.scopes.trim().split(/\s+/) }
						: {}),
				},
				...(cb.local ? {} : { redirectUri: cb.url }),
			},
			{
				onSuccess: ({ authorizationUrl }) => {
					window.open(authorizationUrl, "_blank", "noopener");
					setWaitingSince({ at: Date.now(), known });
				},
			},
		);
	};

	const runTest = (detectedUse: boolean) => {
		setShowErrors(true);
		if (!host) return;
		if (!detectedUse && Object.keys(validateFieldValues(fields, values)).length)
			return;
		setUseDetected(detectedUse);
		test.mutate(draft(detectedUse), {
			onSuccess: (r) => {
				setReport(r);
				setServiceLabel(r.discovered.serviceLabel ?? null);
				if (r.ok) setStep(steps.includes("choose") ? "choose" : "confirm");
			},
		});
		if (mcp) preview.mutate(draft(detectedUse), { onSuccess: setTools });
	};

	const disclosure = report
		? disclosureFor(type, kind, report.discovered.grantedScopes)
		: null;
	const save = () =>
		savedId
			? onOpenChange(false)
			: connect.mutate(draft(useDetected), {
					onSuccess: () => {
						toast({ title: `${type.vendor} connected` });
						onOpenChange(false);
					},
				});

	const index = steps.indexOf(step) + 1;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				data-testid="connect-source-dialog"
				className="sm:max-w-xl"
			>
				<DialogHeader>
					<DialogTitle>
						Connect {type.vendor}
						<span
							className="ml-2 font-normal text-meta text-text-3"
							data-testid="connect-step"
						>
							step {index} of {steps.length}
						</span>
					</DialogTitle>
					<DialogDescription>
						{step === "auth" &&
							"PrismaLens tests what it can read before anything is saved. Every check is a read."}
						{step === "choose" && "Which label names a service in these logs?"}
						{step === "confirm" &&
							(mcp
								? "What the agent gets: every tool this server lists."
								: "What the agent gets. Nothing it can call writes.")}
					</DialogDescription>
				</DialogHeader>

				{step === "auth" && (
					<div className="space-y-4">
						{detected && (
							<div
								className="flex items-center justify-between gap-3 rounded-control bg-surface-3 px-3 py-2"
								data-testid="connect-detected"
							>
								<span className="min-w-0 text-body">
									<StateWord tone="ok">found</StateWord>{" "}
									<Mono>
										{detected.env}
										{detected.url && !detectedToken ? `=${detected.url}` : ""}
									</Mono>
								</span>
								<Button
									variant="primary"
									size="sm"
									disabled={test.isPending}
									onClick={() => runTest(Boolean(detectedToken))}
									data-testid="connect-use-detected"
								>
									Use this
								</Button>
							</div>
						)}
						<Field
							label={type.url.label}
							htmlFor={urlId}
							error={showErrors && !host ? "Enter an http or https URL" : null}
							hint={host ? `Sends the credential only to ${host}` : undefined}
						>
							<Input
								id={urlId}
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								placeholder={type.url.placeholder}
								data-testid="connect-url"
							/>
						</Field>
						{type.scopes && (
							<div
								className="text-meta text-text-3"
								data-testid="connect-scopes"
							>
								<div>Token scopes needed</div>
								<ul>
									{type.scopes.map((sc) => (
										<li key={sc.key}>
											<Mono>{sc.key}</Mono>: {sc.why}
										</li>
									))}
								</ul>
							</div>
						)}
						{type.credentialKinds.length > 1 && (
							<Field label="Authentication" htmlFor={kindId}>
								<Select
									value={kind}
									onValueChange={(v) => {
										setKind(v as SourceCredentialKind);
										setValues({});
									}}
								>
									<SelectTrigger
										id={kindId}
										className="w-full"
										data-testid="connect-auth-kind"
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{type.credentialKinds.map((k) => (
											<SelectItem key={k} value={k}>
												{CREDENTIAL_KIND_LABELS[k]}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
						)}
						{mcp && (
							<>
								<Field
									label="Name"
									htmlFor={nameId}
									hint="Prefixes this server's tools, like n8n_prod__list_workflows"
								>
									<Input
										id={nameId}
										value={name}
										placeholder="n8n_prod"
										onChange={(e) => setName(e.target.value)}
										data-testid="connect-mcp-name"
									/>
								</Field>
								<Field
									label="Description"
									htmlFor={descriptionId}
									error={
										showErrors && !description.trim()
											? "Describe this server in one line"
											: null
									}
								>
									<Input
										id={descriptionId}
										value={description}
										maxLength={80}
										placeholder="Production workflows"
										onChange={(e) => setDescription(e.target.value)}
										data-testid="connect-mcp-description"
									/>
								</Field>
								<p className="text-meta text-text-3" data-testid="mcp-advice">
									Prefer a read-only token if this service offers one.
									PrismaLens forwards every tool this server lists, and what the
									agent does with them is governed by the run's permission
									level. Large servers offer only their first 64 tools; split
									them into narrower servers where the vendor allows.
								</p>
							</>
						)}
						{signingIn && (
							<SignInPanel
								type={type}
								url={url.trim()}
								values={signIn}
								onChange={setSignIn}
								onSignIn={startSignIn}
								pending={oauthStart.isPending}
								waiting={Boolean(waitingSince)}
							/>
						)}
						{!signingIn && fields.length > 0 && (
							<DynamicCredentialForm
								fields={fields}
								values={values}
								onChange={setValues}
								showErrors={showErrors}
							/>
						)}
						{report && !report.ok && <ProbeTable report={report} />}
					</div>
				)}

				{step === "choose" && report && (
					<div className="space-y-4">
						<ProbeTable report={report} />
						<RadioGroup
							value={serviceLabel ?? ""}
							onValueChange={setServiceLabel}
							className="flex flex-wrap gap-x-4 gap-y-2"
							data-testid="connect-service-label"
						>
							{orderedLabels(report, type).map((l) => (
								<span key={l} className="flex items-center gap-1.5 text-body">
									<RadioGroupItem value={l} id={`${labelsId}-${l}`} />
									<label htmlFor={`${labelsId}-${l}`}>
										<Mono>{l}</Mono>
									</label>
								</span>
							))}
						</RadioGroup>
					</div>
				)}

				{step === "confirm" && report && (
					<div className="space-y-4 text-body" data-testid="connect-confirm">
						<p>
							{type.vendor} at <Mono>{report.host}</Mono>
							{report.discovered.identity &&
								` as @${report.discovered.identity}`}
							{serviceLabel && (
								<>
									, services by <Mono>{serviceLabel}</Mono>
								</>
							)}
							.
						</p>
						<ProbeTable report={report} />
						<p>
							{type.tools.length ? (
								<>
									The agent can call:{" "}
									{type.tools.map((t) => (
										<Mono key={t} className="mr-2">
											{t}
										</Mono>
									))}
								</>
							) : (
								type.uses
							)}
						</p>
						{tools?.ok && (
							<ul className="text-meta" data-testid="mcp-preview">
								{tools.tools.map((t) => (
									<li key={t.upstream}>
										<Mono>{t.offered}</Mono>
										{t.shortened && (
											<span className="text-text-3"> (from {t.upstream})</span>
										)}
									</li>
								))}
							</ul>
						)}
						<Disclosure text={disclosure} />
						<p className="text-meta text-text-3">
							The credential is sent only to {report.host}, and a redirect to
							another host is not followed.
						</p>
					</div>
				)}

				<div className="min-h-5">
					<MutationError
						error={
							(test.error ??
								connect.error ??
								oauthStart.error ??
								retest.error) as Error | null
						}
					/>
				</div>
				<DialogFooter>
					{step !== "auth" && (
						<Button variant="text" onClick={() => setStep("auth")}>
							Back
						</Button>
					)}
					{step === "auth" && !signingIn && (
						<Button
							variant={detected ? "secondary" : "primary"}
							disabled={test.isPending}
							onClick={() => runTest(false)}
							data-testid="connect-test"
						>
							{test.isPending ? "Testing" : "Test & discover"}
						</Button>
					)}
					{step === "choose" && (
						<Button
							variant="primary"
							disabled={!serviceLabel}
							onClick={() => setStep("confirm")}
							data-testid="connect-next"
						>
							Next
						</Button>
					)}
					{step === "confirm" && (
						<Button
							variant="primary"
							disabled={connect.isPending}
							onClick={save}
							data-testid="connect-submit"
						>
							{savedId ? "Done" : "Connect"}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Preferred labels first, then the rest, at most twelve. */
function orderedLabels(
	report: ProbeReport,
	type: SourceTypeDescriptor,
): string[] {
	const labels = report.discovered.labels ?? [];
	const preferred = (type.serviceLabel?.preferred ?? []).filter((l) =>
		labels.includes(l),
	);
	return [
		...preferred,
		...labels.filter((l) => !preferred.includes(l) && !l.startsWith("__")),
	].slice(0, 12);
}

/** Capability, needed, PASS or FAIL with the reason, and why PrismaLens asks. */
export function ProbeTable({ report }: { report: ProbeReport }) {
	return (
		<table className="w-full text-meta" data-testid="probe-table">
			<thead className="text-left text-text-3">
				<tr>
					<th className="py-1 pr-3 font-normal">Capability</th>
					<th className="py-1 pr-3 font-normal">Needed</th>
					<th className="py-1 font-normal">Result</th>
				</tr>
			</thead>
			<tbody>
				{report.probes.map((p) => (
					<tr
						key={p.id}
						className="align-top odd:bg-surface-2"
						data-testid="probe-row"
					>
						<td className="py-1.5 pr-3">
							<div className="text-body">{p.capability}</div>
							<div className="text-text-3">{p.why}</div>
						</td>
						<td className="py-1.5 pr-3">{p.need}</td>
						<td className="py-1.5">
							<StateWord
								tone={p.ok ? "ok" : p.need === "required" ? "danger" : "warn"}
							>
								{p.ok ? "PASS" : "FAIL"}
							</StateWord>{" "}
							<span className="text-text-2">{p.detail}</span>
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
