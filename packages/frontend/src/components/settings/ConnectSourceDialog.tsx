// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type ConnectStep,
	CREDENTIAL_KIND_FIELDS,
	CREDENTIAL_KIND_LABELS,
	connectSteps,
	type DetectedSource,
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
	useTestSource,
} from "@/lib/api/hooks/use-sources-orpc";
import { validateFieldValues } from "@/lib/credential-schema";
import { DynamicCredentialForm } from "./DynamicCredentialForm";
import { Field } from "./Field";

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
		test.reset();
		connect.reset();
	}, [open, type, detected, test.reset, connect.reset]);

	const fields = CREDENTIAL_KIND_FIELDS[kind];
	const host = hostOf(url);
	const draft = (detectedUse: boolean): SourceDraft => ({
		type: type.id,
		url: url.trim(),
		...(detectedUse
			? { useDetected: true }
			: { credential: { kind, ...values } }),
		...(serviceLabel ? { serviceLabel } : {}),
	});

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
	};

	const save = () =>
		connect.mutate(draft(useDetected), {
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
							"What the agent gets. Nothing it can call writes."}
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
						{fields.length > 0 && (
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
						<p className="text-meta text-text-3">
							The credential is sent only to {report.host}, and a redirect to
							another host is not followed.
						</p>
					</div>
				)}

				<div className="min-h-5">
					<MutationError
						error={(test.error ?? connect.error) as Error | null}
					/>
				</div>
				<DialogFooter>
					{step !== "auth" && (
						<Button variant="text" onClick={() => setStep("auth")}>
							Back
						</Button>
					)}
					{step === "auth" && (
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
							Connect
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
