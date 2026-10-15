// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	BindingDetection,
	BindingProbeState,
	ServiceBinding,
} from "@prismalens/contracts";
import { useState } from "react";
import { Mono } from "@/components/shared/Mono";
import { MutationError } from "@/components/shared/MutationError";
import { RecordSection } from "@/components/shared/RecordSection";
import { Loading, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	useBindingDetection,
	useCaseFileEnabled,
	useConfirmBinding,
	useProbeBinding,
	useRemoveBinding,
	useServiceBinding,
} from "@/lib/api/hooks/use-case-files-orpc";

export const PROBE_WORDS: Record<BindingProbeState, string> = {
	unchecked: "Not checked yet.",
	ok: "Checked: kubectl can read this namespace.",
	"no-kubectl": "kubectl is not on this machine's PATH.",
	"context-missing": "This context is no longer in the kubeconfig.",
	"identity-mismatch":
		"The context now points at a different cluster or user than when it was bound.",
	unauthorised:
		"kubectl was refused: these credentials cannot read the namespace.",
	unreachable: "The cluster did not answer.",
};

/**
 * Case File capture for one service (experiment, s01): bind it to a kube
 * context and namespace once, then capture runs against that target at alert time.
 */
export function ServiceCaptureSection({ serviceId }: { serviceId: string }) {
	const enabled = useCaseFileEnabled();
	const binding = useServiceBinding(serviceId, enabled);
	if (!enabled) return null;
	return (
		<RecordSection id="case-file" title="Case File capture">
			{binding.isLoading ? (
				<Loading rows={2} />
			) : binding.error ? (
				<Problem
					text="The binding did not load."
					onRetry={() => void binding.refetch()}
				/>
			) : binding.data ? (
				<BoundTarget binding={binding.data} />
			) : (
				<BindForm serviceId={serviceId} />
			)}
		</RecordSection>
	);
}

function BoundTarget({ binding }: { binding: ServiceBinding }) {
	const probe = useProbeBinding();
	const remove = useRemoveBinding();
	const pending = probe.isPending || remove.isPending;
	return (
		<div className="py-2.5" data-testid="capture-bound">
			<div className="flex flex-wrap items-start gap-3">
				<div className="min-w-0 flex-1">
					<p className="text-body text-text-1">
						<Mono>{binding.kubeContext}</Mono> /{" "}
						<Mono>{binding.namespace}</Mono>
					</p>
					<p className="text-meta text-text-3">
						Cluster <Mono>{binding.cluster}</Mono>
					</p>
					<p className="mt-1 text-meta text-text-2" data-testid="capture-probe">
						{PROBE_WORDS[binding.probeState]}
						{binding.probeDetail && ` ${binding.probeDetail}`}
					</p>
				</div>
				<Button
					variant="text"
					size="sm"
					disabled={pending}
					onClick={() => probe.mutate({ serviceId: binding.serviceId })}
					data-testid="capture-probe-again"
				>
					Check again
				</Button>
				<Button
					variant="text"
					size="sm"
					disabled={pending}
					onClick={() => remove.mutate({ serviceId: binding.serviceId })}
					data-testid="capture-unbind"
				>
					Unbind
				</Button>
			</div>
			<MutationError error={probe.error ?? remove.error} className="mt-2" />
		</div>
	);
}

/** The pre-fill: what detection suggests, else the current context and its namespace. */
export function prefill(detection: BindingDetection): {
	kubeContext: string;
	namespace: string;
} {
	return {
		kubeContext:
			detection.suggested?.kubeContext ??
			detection.currentContext ??
			detection.contexts[0] ??
			"",
		namespace:
			detection.suggested?.namespace ??
			detection.current?.namespace ??
			"default",
	};
}

function BindForm({ serviceId }: { serviceId: string }) {
	const detect = useBindingDetection(serviceId, true);
	const confirm = useConfirmBinding();
	const [draft, setDraft] = useState<{
		kubeContext?: string;
		namespace?: string;
	}>({});
	if (detect.isLoading) return <Loading rows={2} />;
	if (detect.error || !detect.data)
		return (
			<Problem
				text="Could not ask kubectl on this machine for its contexts."
				onRetry={() => void detect.refetch()}
			/>
		);
	const detection = detect.data;
	if (!detection.kubectl)
		return (
			<p className="text-body text-text-2" data-testid="capture-no-kubectl">
				kubectl is not on this machine's PATH, so there is nothing to bind to.
			</p>
		);
	if (detection.contexts.length === 0)
		return (
			<p className="text-body text-text-2">
				kubectl on this machine has no contexts.
			</p>
		);
	const initial = prefill(detection);
	const kubeContext = draft.kubeContext ?? initial.kubeContext;
	const namespace = draft.namespace ?? initial.namespace;
	return (
		<form
			className="flex flex-col gap-2 py-2.5"
			onSubmit={(e) => {
				e.preventDefault();
				confirm.mutate({ serviceId, kubeContext, namespace: namespace.trim() });
			}}
			data-testid="capture-bind-form"
		>
			<p className="text-meta text-text-3">
				Detected from kubectl on this machine.
			</p>
			<div className="flex flex-wrap items-end gap-2">
				<div className="flex min-w-48 flex-1 flex-col gap-1">
					<label className="text-meta text-text-2" htmlFor="capture-context">
						Context
					</label>
					<Select
						value={kubeContext}
						onValueChange={(v) => setDraft((d) => ({ ...d, kubeContext: v }))}
					>
						<SelectTrigger
							id="capture-context"
							className="w-full"
							data-testid="capture-context"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{detection.contexts.map((c) => (
								<SelectItem key={c} value={c}>
									{c}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex min-w-36 flex-col gap-1">
					<label className="text-meta text-text-2" htmlFor="capture-namespace">
						Namespace
					</label>
					<Input
						id="capture-namespace"
						value={namespace}
						onChange={(e) =>
							setDraft((d) => ({ ...d, namespace: e.target.value }))
						}
						spellCheck={false}
						data-testid="capture-namespace"
					/>
				</div>
				<Button
					type="submit"
					size="sm"
					disabled={confirm.isPending || !kubeContext || !namespace.trim()}
					data-testid="capture-confirm"
				>
					Confirm
				</Button>
			</div>
			<MutationError error={confirm.error} />
		</form>
	);
}
