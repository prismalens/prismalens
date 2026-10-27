// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Retention, RunWorkspaceSettings } from "@prismalens/contracts";
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type WorkspaceField = keyof RunWorkspaceSettings;

/** The order the fields read in, and what each is called (#925). */
export const FIELDS: { key: WorkspaceField; label: string }[] = [
	{ key: "method", label: "Method" },
	{ key: "location", label: "Location" },
	{ key: "retention", label: "After a run" },
	{ key: "keptPerProject", label: "Kept per service" },
	{ key: "setup", label: "Setup command" },
	{ key: "teardown", label: "Teardown command" },
	{ key: "copyIn", label: "Files to copy in" },
	{ key: "submodules", label: "Submodules" },
	{ key: "branch", label: "Branch" },
];

const METHOD = {
	worktree: "Worktree of your repo",
	clone: "Clone of your repo",
} as const;
const RETENTION: Record<Retention["kind"], string> = {
	"remove-unless-changed": "Remove unless changed",
	"always-remove": "Always remove",
	"keep-days": "Keep for some days",
	"keep-until-resolved": "Keep until the incident is resolved",
};
const SUBMODULES = {
	skip: "Skip",
	"top-level": "Top level",
	recursive: "Recursive",
} as const;
const BRANCH = {
	detached: "Detached",
	named: "Named prismalens/<incident>-<run>",
} as const;

function commands(c: RunWorkspaceSettings["setup"]): string {
	const parts = [
		c.posix?.trim() && `macOS and Linux: ${c.posix.trim()}`,
		c.windows?.trim() && `Windows: ${c.windows.trim()}`,
	].filter(Boolean);
	return parts.length ? parts.join("; ") : "None";
}

/** One line for a field's value, as a summary or as "From global settings · …". */
export function describeField(
	key: WorkspaceField,
	s: RunWorkspaceSettings,
	defaultLocation: string,
): string {
	switch (key) {
		case "method":
			return METHOD[s.method];
		case "location":
			return s.location ?? defaultLocation;
		case "retention":
			return s.retention.kind === "keep-days"
				? `Keep for ${s.retention.days} days`
				: RETENTION[s.retention.kind];
		case "keptPerProject":
			return String(s.keptPerProject);
		case "setup":
		case "teardown":
			return commands(s[key]);
		case "copyIn":
			return s.copyIn.length ? s.copyIn.join(", ") : "None";
		case "submodules":
			return SUBMODULES[s.submodules];
		case "branch":
			return BRANCH[s.branch];
	}
}

function Choice<T extends string>({
	value,
	options,
	label,
	onChange,
	disabled,
}: {
	value: T;
	options: Record<T, string>;
	label: string;
	onChange: (v: T) => void;
	disabled?: boolean;
}) {
	return (
		<Select
			value={value}
			onValueChange={(v) => onChange(v as T)}
			disabled={disabled}
		>
			<SelectTrigger aria-label={label} className="w-full sm:w-72">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{(Object.keys(options) as T[]).map((k) => (
					<SelectItem key={k} value={k}>
						{options[k]}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function CommandsEditor({
	value,
	label,
	onChange,
	disabled,
}: {
	value: RunWorkspaceSettings["setup"];
	label: string;
	onChange: (v: RunWorkspaceSettings["setup"]) => void;
	disabled?: boolean;
}) {
	const set = (os: "posix" | "windows", text: string) => {
		const next = { ...value };
		if (text.trim()) next[os] = text;
		else delete next[os];
		onChange(next);
	};
	return (
		<div className="grid gap-2">
			<Input
				aria-label={`${label} on macOS and Linux`}
				placeholder="macOS and Linux, e.g. pnpm install"
				value={value.posix ?? ""}
				onChange={(e) => set("posix", e.target.value)}
				disabled={disabled}
				className="font-mono"
			/>
			<Input
				aria-label={`${label} on Windows`}
				placeholder="Windows, e.g. pnpm install"
				value={value.windows ?? ""}
				onChange={(e) => set("windows", e.target.value)}
				disabled={disabled}
				className="font-mono"
			/>
		</div>
	);
}

/** The control for one field; `onChange` gets the whole field value. */
export function FieldEditor({
	field,
	value,
	defaultLocation,
	onChange,
	disabled,
}: {
	field: WorkspaceField;
	value: RunWorkspaceSettings;
	defaultLocation: string;
	onChange: <K extends WorkspaceField>(
		key: K,
		v: RunWorkspaceSettings[K],
	) => void;
	disabled?: boolean;
}): ReactNode {
	switch (field) {
		case "method":
			return (
				<Choice
					label="Method"
					value={value.method}
					options={METHOD}
					onChange={(v) => onChange("method", v)}
					disabled={disabled}
				/>
			);
		case "location":
			return (
				<Input
					aria-label="Location"
					placeholder={defaultLocation}
					value={value.location ?? ""}
					onChange={(e) =>
						onChange("location", e.target.value.trim() ? e.target.value : null)
					}
					disabled={disabled}
					className="font-mono"
				/>
			);
		case "retention": {
			const r = value.retention;
			return (
				<div className="flex flex-wrap items-center gap-2">
					<Choice
						label="After a run"
						value={r.kind}
						options={RETENTION}
						onChange={(kind) =>
							onChange(
								"retention",
								kind === "keep-days"
									? { kind, days: r.kind === "keep-days" ? r.days : 7 }
									: { kind },
							)
						}
						disabled={disabled}
					/>
					{r.kind === "keep-days" && (
						<Input
							aria-label="Days to keep"
							type="number"
							min={1}
							max={365}
							value={r.days}
							onChange={(e) =>
								onChange("retention", {
									kind: "keep-days",
									days: Number(e.target.value) || 1,
								})
							}
							disabled={disabled}
							className="w-24"
						/>
					)}
				</div>
			);
		}
		case "keptPerProject":
			return (
				<Input
					aria-label="Kept per service"
					type="number"
					min={1}
					max={100}
					value={value.keptPerProject}
					onChange={(e) =>
						onChange("keptPerProject", Number(e.target.value) || 1)
					}
					disabled={disabled}
					className="w-24"
				/>
			);
		case "setup":
		case "teardown":
			return (
				<CommandsEditor
					label={field === "setup" ? "Setup command" : "Teardown command"}
					value={value[field]}
					onChange={(v) => onChange(field, v)}
					disabled={disabled}
				/>
			);
		case "copyIn":
			return (
				<Textarea
					aria-label="Files to copy in"
					placeholder={".env\nconfig/local.json"}
					value={value.copyIn.join("\n")}
					onChange={(e) =>
						onChange(
							"copyIn",
							e.target.value
								.split("\n")
								.map((l) => l.trim())
								.filter(Boolean),
						)
					}
					disabled={disabled}
					className="font-mono"
					rows={3}
				/>
			);
		case "submodules":
			return (
				<Choice
					label="Submodules"
					value={value.submodules}
					options={SUBMODULES}
					onChange={(v) => onChange("submodules", v)}
					disabled={disabled}
				/>
			);
		case "branch":
			return (
				<Choice
					label="Branch"
					value={value.branch}
					options={BRANCH}
					onChange={(v) => onChange("branch", v)}
					disabled={disabled}
				/>
			);
	}
}

/** What each field is for, under its label. */
export const HELP: Record<WorkspaceField, string> = {
	method:
		"A local folder is checked out as a worktree of it, or cloned. A git URL is always cloned.",
	location: "The folder run workspaces are made in.",
	retention:
		"Changed means uncommitted edits or new files that are not ignored. Ignored files never count.",
	keptPerProject: "The oldest kept workspaces beyond this many go first.",
	setup:
		"Runs in the new workspace before the agent starts. Cancelled after 5 minutes with no output.",
	teardown:
		"Runs before a workspace is removed, for 60 seconds at most. Changes are checked again after it.",
	copyIn:
		"Paths from the top of your repo, such as ignored .env files, copied into each workspace.",
	submodules: "Whether to check out the repo's submodules.",
	branch:
		"A run reads the code at a commit; a named branch is there if you want to keep its work.",
};

/** Why a workspace was removed or kept, as the history and the run page say it. */
export const REASONS: Record<string, string> = {
	unchanged: "nothing had changed",
	"always-remove": "the setting is Always remove",
	expired: "its days were up",
	resolved: "its incident was resolved",
	"over-cap": "more were kept than the setting allows",
	"removed-by-user": "you removed it",
	gone: "it was already gone",
	changed: "it holds changes",
	"keep-days": "kept for some days",
	"keep-until-resolved": "kept until its incident is resolved",
	live: "its run is still going",
	"locked-by-other": "another program holds it",
	symlinked: "it is a link",
	shared: "other worktrees hang off it",
	"nested-checkout": "a checkout inside it is set up",
	"remove-failed": "it could not be deleted",
};
