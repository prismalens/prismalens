// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type DetectedSource,
	DISCLOSURE,
	SOURCE_CATEGORY_INFO,
	SOURCE_TYPES,
	type SourceCategoryView,
	type SourceTypeDescriptor,
	sourceType,
} from "@prismalens/contracts/schemas";
import { useEffect, useId, useState } from "react";
import { InlineCode } from "@/components/shared/InlineCode";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
	useRenameSource,
	useRetestSource,
	useSourcesOverview,
} from "@/lib/api/hooks/use-sources-orpc";
import { getErrorMessage } from "@/lib/get-error-message";
import { ConnectSourceDialog } from "./ConnectSourceDialog";
import { Field } from "./Field";
import { RunbooksDialog } from "./RunbooksDialog";

const STATUS_WORD = {
	connected: { tone: "ok", word: "Connected" },
	unreachable: { tone: "danger", word: "Unreachable" },
	"not-configured": { tone: "quiet", word: "Not connected" },
	removed: { tone: "quiet", word: "Removed" },
} as const;

/** What a server callback's redirect says (04); never upstream text. */
const SIGN_IN_ERROR: Record<string, string> = {
	state: "The sign-in expired or was already used. Start it again.",
	denied: "The sign-in was declined.",
	exchange: "The vendor did not complete the sign-in.",
	probe:
		"Signed in, but the source did not answer its checks; nothing was saved.",
};

/** A source's reason, with the way out when its sign-in needs more permission. */
export function reasonText(reason: string | undefined): string | undefined {
	if (!reason) return undefined;
	return reason.startsWith("needs permission:")
		? `${reason} — sign in again`
		: reason;
}

type SourceItem = SourceCategoryView["sources"][number];

/**
 * Settings, Data sources (#848): one row per category the agent reads, its state,
 * and the vendors to connect, a detected one first with "found".
 */
export function DataSources() {
	const { data, isLoading } = useSourcesOverview();
	const [runbooksOpen, setRunbooksOpen] = useState(false);
	const [renaming, setRenaming] = useState<SourceItem | null>(null);
	const { toast } = useToast();
	useEffect(() => {
		const q = new URLSearchParams(window.location.search);
		const error = q.get("error");
		if (q.get("connected")) toast({ title: "Signed in and connected" });
		else if (error && SIGN_IN_ERROR[error])
			toast({
				title: "Sign-in did not finish",
				description: SIGN_IN_ERROR[error],
				variant: "destructive",
			});
	}, [toast]);
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
							disclosed={data?.disclosed ?? []}
							onRename={setRenaming}
							onPick={(type, detected) => setPicked({ type, detected })}
							onRunbooks={() => setRunbooksOpen(true)}
						/>
					))}
				</Pool>
			</SettingGroup>
			<RunbooksDialog
				source={data?.categories
					.find((c) => c.category === "knowledge")
					?.sources.find((s) => s.id === "runbooks")}
				open={runbooksOpen}
				onOpenChange={setRunbooksOpen}
			/>
			<RenameDialog source={renaming} onClose={() => setRenaming(null)} />
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
	onRunbooks,
	disclosed,
	onRename,
}: {
	view: SourceCategoryView;
	detected: DetectedSource[];
	disclosed: string[];
	onRename: (s: SourceItem) => void;
	onPick: (type: SourceTypeDescriptor, detected?: DetectedSource) => void;
	onRunbooks: () => void;
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
	const broken = view.sources.find(
		(s) =>
			s.status === "unreachable" || s.reason?.startsWith("needs permission:"),
	);
	const wide = view.sources.some((s) => disclosed.includes(s.id));
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
						{info.blind} Have the deploy job POST each release to{" "}
						<InlineCode text="/api/webhooks/deploy" />.
					</>
				) : view.status === "not-configured" ? (
					info.blind
				) : (
					<>
						{view.sources
							.filter((s) => s.status !== "not-configured")
							.map((s) =>
								s.name
									? `${s.name}: ${s.description ?? ""}${s.toolCount !== undefined ? ` (${s.toolCount} tools)` : ""}`
									: s.label,
							)
							.join(", ")}
						{broken?.reason &&
							`. ${broken.label}: ${reasonText(broken.reason)}`}
						{view.tools.length > 0 && `. ${view.tools.length} read-only tools`}
						{wide && (
							<span className="block" data-testid="row-disclosure">
								{view.category === "mcp" ? DISCLOSURE.token : DISCLOSURE.signIn}
							</span>
						)}
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
			{view.category === "knowledge" && (
				<>
					<Button
						variant="secondary"
						size="sm"
						onClick={onRunbooks}
						data-testid="connect-runbooks"
					>
						Runbooks in your repos
					</Button>
					{view.sources
						.filter((s) => s.kind === "unsupported")
						.map((s) => (
							<Button
								key={s.id}
								variant="text"
								size="sm"
								disabled
								data-testid={`unsupported-${s.id}`}
							>
								{s.label}: not supported yet
							</Button>
						))}
				</>
			)}
			{view.sources
				.filter((s) => s.kind === "mcp-server")
				.map((s) => (
					<Button
						key={`rename-${s.id}`}
						variant="text"
						size="sm"
						onClick={() => onRename(s)}
						data-testid={`rename-${s.id}`}
					>
						Rename {s.name ?? s.label}
					</Button>
				))}
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

/** A vendor MCP connection's name and description; tools take the new name from the next run (06). */
function RenameDialog({
	source,
	onClose,
}: {
	source: SourceItem | null;
	onClose: () => void;
}) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const rename = useRenameSource();
	const nameId = useId();
	const descriptionId = useId();
	const reset = rename.reset;
	useEffect(() => {
		setName(source?.name ?? "");
		setDescription(source?.description ?? "");
		reset();
	}, [source, reset]);
	return (
		<Dialog open={Boolean(source)} onOpenChange={(o) => !o && onClose()}>
			<DialogContent data-testid="rename-source-dialog">
				<DialogHeader>
					<DialogTitle>Rename {source?.label}</DialogTitle>
				</DialogHeader>
				<Field
					label="Name"
					htmlFor={nameId}
					hint="Tools take the new name from the next run."
					error={rename.error ? getErrorMessage(rename.error) : null}
				>
					<Input
						id={nameId}
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
				</Field>
				<Field label="Description" htmlFor={descriptionId}>
					<Input
						id={descriptionId}
						value={description}
						maxLength={80}
						onChange={(e) => setDescription(e.target.value)}
					/>
				</Field>
				<DialogFooter>
					<Button
						variant="primary"
						disabled={rename.isPending || !name.trim() || !description.trim()}
						onClick={() =>
							source &&
							rename.mutate(
								{
									id: source.id,
									name: name.trim(),
									description: description.trim(),
								},
								{ onSuccess: onClose },
							)
						}
					>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
