// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type DetectedSource,
	SOURCE_CATEGORY_INFO,
	SOURCE_TYPES,
	type SourceCategoryView,
	type SourceTypeDescriptor,
	sourceType,
} from "@prismalens/contracts/schemas";
import { useState } from "react";
import { InlineCode } from "@/components/shared/InlineCode";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
	useRetestSource,
	useSourcesOverview,
} from "@/lib/api/hooks/use-sources-orpc";
import { getErrorMessage } from "@/lib/get-error-message";
import { ConnectSourceDialog } from "./ConnectSourceDialog";

const STATUS_WORD = {
	connected: { tone: "ok", word: "Connected" },
	unreachable: { tone: "danger", word: "Unreachable" },
	"not-configured": { tone: "quiet", word: "Not connected" },
} as const;

/**
 * Settings, Data sources (#848): one row per category the agent reads, its state,
 * and the vendors to connect, a detected one first with "found".
 */
export function DataSources() {
	const { data, isLoading } = useSourcesOverview();
	const [picked, setPicked] = useState<{
		type: SourceTypeDescriptor;
		detected?: DetectedSource;
	} | null>(null);
	return (
		<>
			<SettingGroup
				title="What investigations can read"
				testId="data-sources"
				description={
					isLoading
						? "Probing each source"
						: "PrismaLens probes each source with reads only. A category nobody connected is a blind spot the report names."
				}
			>
				<Pool>
					{(data?.categories ?? []).map((c) => (
						<CategoryRow
							key={c.category}
							view={c}
							detected={data?.detected ?? []}
							onPick={(type, detected) => setPicked({ type, detected })}
						/>
					))}
				</Pool>
			</SettingGroup>
			{picked && (
				<ConnectSourceDialog
					type={picked.type}
					detected={picked.detected}
					open={Boolean(picked)}
					onOpenChange={(o) => !o && setPicked(null)}
				/>
			)}
		</>
	);
}

function CategoryRow({
	view,
	detected,
	onPick,
}: {
	view: SourceCategoryView;
	detected: DetectedSource[];
	onPick: (type: SourceTypeDescriptor, detected?: DetectedSource) => void;
}) {
	const info = SOURCE_CATEGORY_INFO[view.category];
	const state = STATUS_WORD[view.status];
	const found = (t: SourceTypeDescriptor) =>
		detected.find((d) => d.type === t.id);
	const types = SOURCE_TYPES.filter((t) => t.category === view.category).sort(
		(a, b) => Number(Boolean(found(b))) - Number(Boolean(found(a))),
	);
	const retest = useRetestSource();
	const { toast } = useToast();
	const probeable = view.sources.filter((s) => sourceType(s.kind));
	const testAll = async () => {
		try {
			const reports = await Promise.all(
				probeable.map((s) => retest.mutateAsync({ id: s.id })),
			);
			const bad = reports.flatMap((r) =>
				r.probes.filter((p) => !p.ok && p.need === "required"),
			);
			toast(
				bad.length
					? {
							title: `${info.label}: a required check failed`,
							description: bad
								.map((p) => `${p.capability}: ${p.detail}`)
								.join("; "),
							variant: "destructive",
						}
					: { title: `${info.label}: every required check passed` },
			);
		} catch (e) {
			toast({
				title: "Test did not run",
				description: getErrorMessage(e),
				variant: "destructive",
			});
		}
	};
	const broken = view.sources.find((s) => s.status === "unreachable");
	return (
		<SettingRow
			testId={`data-source-${view.category}`}
			label={
				<span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
					<span>{info.label}</span>
					<StateWord tone={state.tone} data-testid="data-source-state">
						{state.word}
					</StateWord>
				</span>
			}
			description={
				view.category === "deploys" && view.status === "not-configured" ? (
					<>
						{info.blind} Add <InlineCode text="pl deploy" /> to the deploy job
						to send each release.
					</>
				) : view.status === "not-configured" ? (
					info.blind
				) : (
					<>
						{view.sources.map((s) => s.label).join(", ")}
						{broken?.reason && `. ${broken.label}: ${broken.reason}`}
						{view.tools.length > 0 && `. ${view.tools.length} read-only tools`}
					</>
				)
			}
		>
			{probeable.length > 0 && (
				<Button
					variant="text"
					size="sm"
					disabled={retest.isPending}
					onClick={testAll}
				>
					Test
				</Button>
			)}
			{types.map((t) => {
				const d = found(t);
				return (
					<Button
						key={t.id}
						variant={d ? "primary" : "secondary"}
						size="sm"
						onClick={() => onPick(t, d)}
						data-testid={`connect-${t.slug}`}
					>
						{t.vendor}
						{d && <span className="ml-1 opacity-80">found</span>}
					</Button>
				);
			})}
		</SettingRow>
	);
}
