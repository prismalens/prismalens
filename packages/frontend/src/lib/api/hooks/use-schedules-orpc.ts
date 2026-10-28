// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RecurrenceInput } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../orpc-client";

/** Every device reads the same schedules; the `schedules` live topic refreshes them (#979). */
export function useSchedules() {
	return useQuery(orpc.schedules.list.queryOptions({ input: {} }));
}

export function useSchedule(id: string) {
	return useQuery(
		orpc.schedules.get.queryOptions({ input: { id, limit: 30 } }),
	);
}

export function useSchedulePreview(recurrence: RecurrenceInput | null) {
	return useQuery({
		...orpc.schedules.preview.queryOptions({
			input: { recurrence: recurrence as RecurrenceInput },
		}),
		enabled: recurrence !== null,
		staleTime: 60_000,
	});
}

function useInvalidate() {
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({ queryKey: orpc.schedules.key() });
}

export function useCreateSchedule() {
	const onSuccess = useInvalidate();
	return useMutation({ ...orpc.schedules.create.mutationOptions(), onSuccess });
}

export function useUpdateSchedule() {
	const onSuccess = useInvalidate();
	return useMutation({ ...orpc.schedules.update.mutationOptions(), onSuccess });
}

export function useSetScheduleEnabled() {
	const onSuccess = useInvalidate();
	return useMutation({
		...orpc.schedules.setEnabled.mutationOptions(),
		onSuccess,
	});
}

export function useRunScheduleNow() {
	const onSuccess = useInvalidate();
	return useMutation({ ...orpc.schedules.runNow.mutationOptions(), onSuccess });
}

export function useDeleteSchedule() {
	const onSuccess = useInvalidate();
	return useMutation({ ...orpc.schedules.remove.mutationOptions(), onSuccess });
}
