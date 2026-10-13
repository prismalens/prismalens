// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isAlertFiring, isRunStateLive } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	reportedRun,
	useIncidentRecord,
} from "@/components/incidents/record-context";
import { useInvestigationRun } from "@/components/investigation/useInvestigationRun";
import { refRunState } from "@/components/run/run-labels";
import { useToast } from "@/hooks/use-toast";
import { timelineKeys } from "@/lib/api/hooks";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { client, orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { copyOrSelect } from "./clipboard";
import {
	AUTO_CHECK_MS,
	commandOf,
	type FixCheck,
	type FixOption,
	type FixStage,
	fixStage,
	liveCheck,
	splitOptions,
} from "./fixes";

/** The impact query's own deadline is 10 s; past it the card says so and nothing else waits. */
const SLOW_MS = 10_000;

const keyOf = (o: FixOption) => o.id ?? `#${o.index}`;

/**
 * Everything the overview reads (#811): the standing finding and its fixes
 * with their applied and checked state, the latest Ask, the impact query,
 * and what changed.
 */
export function useOverview() {
	const record = useIncidentRecord();
	const { incident, runs } = record;
	const queryClient = useQueryClient();
	const { toast } = useToast();

	const reported = reportedRun(runs);
	const reportRun = useInvestigationRun(reported?.id ?? null);
	const report = reportRun.investigation?.report ?? null;

	const fixesQuery = useQuery({
		...orpc.fixes.forInvestigation.queryOptions({
			input: { id: reported?.id ?? "" },
		}),
		enabled: !!reported,
	});
	const options = useMemo(
		() => splitOptions(fixesQuery.data),
		[fixesQuery.data],
	);

	const ask = runs.find((r) => r.kind === "chat") ?? null;
	const askRun = useInvestigationRun(ask?.id ?? null);
	const earlierAsks = runs.filter((r) => r.kind === "chat").slice(1);

	const latest = runs.find((r) => r.kind !== "chat") ?? null;
	const latestOwn = useInvestigationRun(
		latest && latest.id !== reported?.id ? latest.id : null,
	);
	const latestRun =
		latest && latest.id === reported?.id ? reportRun : latestOwn;
	const latestState = latest ? refRunState(latest) : null;
	const live =
		latest && latestState && isRunStateLive(latestState) ? latest : null;

	const impactQuery = useQuery({
		...orpc.impact.forIncident.queryOptions({ input: { id: incident.id } }),
		retry: false,
		refetchOnWindowFocus: false,
		staleTime: 60_000,
	});
	const [slow, setSlow] = useState(false);
	const fetching = impactQuery.isFetching;
	useEffect(() => {
		setSlow(false);
		if (!fetching) return;
		const t = window.setTimeout(() => setSlow(true), SLOW_MS);
		return () => window.clearTimeout(t);
	}, [fetching]);
	const impact = impactQuery.data ?? null;
	const checkable = impact?.checkable ?? false;

	const [allChanges, setAllChanges] = useState(false);
	const changes = useQuery({
		...orpc.changes.forIncident.queryOptions({
			input: { id: incident.id, limit: allChanges ? 200 : 6 },
		}),
		placeholderData: (prev) => prev,
		refetchInterval: (q) => (q.state.data?.refreshing ? 3000 : false),
	});

	const service = incident.service?.id;
	const topology = useQuery({
		...orpc.services.getTopology.queryOptions({
			input: { id: service ?? "" },
		}),
		enabled: !!service,
	});

	// Copy and the live check answer are this session's; applied and the last verdict are the server's.
	const [pick, setPick] = useState(0);
	const [copied, setCopied] = useState<Record<string, "ok" | "failed">>({});
	const [checking, setChecking] = useState<Record<string, boolean>>({});
	const [fresh, setFresh] = useState<Record<string, FixCheck>>({});
	const current = options.stop[Math.min(pick, options.stop.length - 1)] ?? null;
	const others = options.stop.filter((o) => o !== current);
	const alerts = incident.alerts ?? [];

	const stageOf = (o: FixOption): FixStage => {
		const key = keyOf(o);
		return fixStage({
			option: o,
			copied: !!copied[key],
			copyFailed: copied[key] === "failed",
			checking: !!checking[key],
			check: fresh[key] ?? null,
			alerts,
		});
	};

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: orpc.fixes.forInvestigation.key(),
			}),
			queryClient.invalidateQueries({ queryKey: timelineKeys.all() }),
			queryClient.invalidateQueries({ queryKey: incidentKeys.all() }),
		]);
	const failed = (title: string) => (error: unknown) =>
		toast({
			title,
			description: getErrorMessage(error),
			variant: "destructive",
		});

	const apply = useMutation({
		mutationFn: (o: FixOption) =>
			o.id ? client.fixes.apply({ id: o.id }) : Promise.resolve(null),
		onSettled: invalidate,
		onError: failed("Not recorded"),
	});
	const undo = useMutation({
		mutationFn: (o: FixOption) =>
			o.id ? client.fixes.undo({ id: o.id }) : Promise.resolve(null),
		onSettled: invalidate,
		onError: failed("Not undone"),
	});

	const check = async (o: FixOption) => {
		if (!o.id) return;
		const key = keyOf(o);
		setChecking((c) => ({ ...c, [key]: true }));
		try {
			const r = await client.fixes.check({ id: o.id });
			setFresh((f) => ({
				...f,
				[key]: liveCheck(r),
			}));
		} catch {
			setFresh((f) => ({
				...f,
				[key]: {
					verdict: "could_not_check",
					at: new Date().toISOString(),
					retryable: true,
				},
			}));
		} finally {
			setChecking((c) => ({ ...c, [key]: false }));
			void invalidate();
		}
	};

	// The +5 min check runs once per option, on this page, when it is due.
	const autoRan = useRef(new Set<string>());
	const checkRef = useRef(check);
	checkRef.current = check;
	const currentStage = current ? stageOf(current) : null;
	const dueAt =
		currentStage?.stage === "applied" && checkable
			? Date.parse(currentStage.appliedAt) + AUTO_CHECK_MS
			: null;
	useEffect(() => {
		if (dueAt === null || !current) return;
		const key = keyOf(current);
		if (autoRan.current.has(key)) return;
		const t = window.setTimeout(
			() => {
				autoRan.current.add(key);
				void checkRef.current(current);
			},
			Math.max(0, dueAt - Date.now()),
		);
		return () => window.clearTimeout(t);
	}, [dueAt, current]);

	const copy = async (o: FixOption, el: HTMLElement | null) => {
		const command = commandOf(o);
		if (!command) return false;
		const ok = await copyOrSelect(command, el);
		setCopied((c) => ({ ...c, [keyOf(o)]: ok ? "ok" : "failed" }));
		return ok;
	};

	return {
		record,
		report,
		reported,
		reportInvestigation: reportRun.investigation,
		flagged:
			fixesQuery.data?.flagged ?? (report?.flaggedContent?.length ?? 0) > 0,
		options,
		current,
		others,
		stage: currentStage,
		stageOf,
		nextOption: () =>
			setPick((p) => (p + 1) % Math.max(1, options.stop.length)),
		pickOption: (o: FixOption) => setPick(options.stop.indexOf(o)),
		copy,
		apply: (o: FixOption) => apply.mutate(o),
		undo: (o: FixOption) => undo.mutate(o),
		check,
		busy: apply.isPending || undo.isPending,
		ask,
		askRun,
		earlierAsks,
		latest,
		latestRun,
		live,
		impact: {
			impact,
			pending: impactQuery.isPending,
			slow: slow && impactQuery.isFetching && !impact,
			failed: impactQuery.error ? getErrorMessage(impactQuery.error) : null,
			firing: alerts.filter((a) => isAlertFiring(a.status)).length,
			retry: () => void impactQuery.refetch(),
		},
		checkable,
		changes: changes.data,
		allChanges,
		setAllChanges,
		dependencies: topology.data?.upstream ?? [],
		cleared: alerts.length > 0 && !alerts.some((a) => isAlertFiring(a.status)),
	};
}

export type Overview = ReturnType<typeof useOverview>;
