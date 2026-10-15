// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

/**
 * Case File hooks (experiment, behind Setting `case_file`): the setting, a
 * service's Kubernetes binding, and an incident's case.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

export const caseFileKeys = {
	all: () => orpc.caseFiles.key(),
	settings: () => orpc.caseFiles.settings.get.queryKey(),
	binding: (serviceId: string) =>
		orpc.caseFiles.bindings.get.queryKey({ input: { serviceId } }),
	cases: () => orpc.caseFiles.cases.key(),
};

export function useCaseFileSettings() {
	return useQuery({
		...orpc.caseFiles.settings.get.queryOptions(),
		retry: false,
	});
}

/** Off until the server says on: a missing or failing settings route reads as off. */
export function useCaseFileEnabled(): boolean {
	return useCaseFileSettings().data?.enabled === true;
}

export function useUpdateCaseFileSettings() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.caseFiles.settings.update.mutationOptions(),
		onSuccess: (data) =>
			queryClient.setQueryData(caseFileKeys.settings(), data),
	});
}

export function useServiceBinding(serviceId: string, enabled: boolean) {
	return useQuery({
		...orpc.caseFiles.bindings.get.queryOptions({ input: { serviceId } }),
		enabled,
	});
}

/** Runs kubectl on the host, so only while the binding form is open. */
export function useBindingDetection(serviceId: string, enabled: boolean) {
	return useQuery({
		...orpc.caseFiles.bindings.detect.queryOptions({ input: { serviceId } }),
		enabled,
		staleTime: 60_000,
	});
}

export function useConfirmBinding() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.caseFiles.bindings.confirm.mutationOptions(),
		onSuccess: (binding) =>
			queryClient.setQueryData(
				caseFileKeys.binding(binding.serviceId),
				binding,
			),
	});
}

export function useProbeBinding() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.caseFiles.bindings.probe.mutationOptions(),
		onSuccess: (binding) =>
			queryClient.setQueryData(
				caseFileKeys.binding(binding.serviceId),
				binding,
			),
	});
}

export function useRemoveBinding() {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.caseFiles.bindings.remove.mutationOptions(),
		onSuccess: (_data, { serviceId }) =>
			queryClient.setQueryData(caseFileKeys.binding(serviceId), null),
	});
}

export function useCaseView(incidentId: string, enabled: boolean) {
	return useQuery({
		...orpc.caseFiles.cases.get.queryOptions({ input: { incidentId } }),
		enabled,
	});
}

/** The redacted copy only; the server caps it at 1 MiB. */
export function useCaseArtifact(artifactId: string | null) {
	return useQuery({
		...orpc.caseFiles.cases.artifact.queryOptions({
			input: { artifactId: artifactId ?? "" },
		}),
		enabled: !!artifactId,
		retry: false,
	});
}

export function useVerifyCase() {
	return useMutation(orpc.caseFiles.cases.verify.mutationOptions());
}
