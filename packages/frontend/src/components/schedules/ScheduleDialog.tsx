// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import type { Schedule, ScheduleInput } from "@prismalens/contracts";
import { useEffect, useMemo, useState } from "react";
import { ModelChip, useAgentChoice } from "@/components/agent/AgentPicker";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	useCreateSchedule,
	useSchedulePreview,
	useServices,
	useUpdateSchedule,
} from "@/lib/api/hooks";
import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";
import {
	defaultWhen,
	formOf,
	type Preset,
	recurrenceOf,
	type WhenForm,
} from "./schedule-form";
import { nextRunsText } from "./schedule-time";

const PRESETS: Array<[Preset, string]> = [
	["daily", "Every day"],
	["weekdays", "Weekdays"],
	["weekly", "Weekly"],
	["hours", "Every few hours"],
	["cron", "Cron"],
];
const DAYS: Array<[number, string]> = [
	[1, "Mo"],
	[2, "Tu"],
	[3, "We"],
	[4, "Th"],
	[5, "Fr"],
	[6, "Sa"],
	[0, "Su"],
];
const DAY_NAMES = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];
const HOURS = [1, 2, 3, 4, 6, 8, 12];
const HOST_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const CATCH_UP_MINUTES = 360;

function zones(current: string): string[] {
	const all = Intl.supportedValuesOf?.("timeZone") ?? [];
	return Array.from(new Set([HOST_ZONE, current, "UTC", ...all]));
}

/** The value settles 300 ms after the last keystroke, so a preview isn't asked per character. */
function useSettled<T>(value: T): T {
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setSettled(value), 300);
		return () => clearTimeout(t);
	}, [value]);
	return settled;
}

/** New and Edit schedule (#979): one fixed-size dialog, full screen on a phone. */
export function ScheduleDialog({
	open,
	onOpenChange,
	editing,
	copyOf,
	canSetHostZone,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	editing?: Schedule;
	/** Duplicate: a new schedule that starts from this one's values. */
	copyOf?: Schedule;
	canSetHostZone: boolean;
}) {
	const agents = useAgentChoice();
	const services = useServices({ limit: 100 }).data?.data ?? [];
	const create = useCreateSchedule();
	const update = useUpdateSchedule();
	const [name, setName] = useState("");
	const [serviceId, setServiceId] = useState("");
	const [runbook, setRunbook] = useState("");
	const [brief, setBrief] = useState("");
	const [when, setWhen] = useState<WhenForm>(defaultWhen(HOST_ZONE));
	const [harness, setHarness] = useState<string>("");
	const [model, setModel] = useState("");
	const [missedPolicy, setMissedPolicy] = useState<"run_once" | "skip">(
		"run_once",
	);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		const seed = editing ?? copyOf;
		setError(null);
		setName(editing?.name ?? (copyOf ? `${copyOf.name} (copy)` : ""));
		setServiceId(seed?.serviceId ?? "");
		setRunbook(seed?.runbook ?? "");
		setBrief(seed?.brief ?? "");
		setWhen(seed ? formOf(seed.recurrence) : defaultWhen(HOST_ZONE));
		setHarness(seed?.harness ?? agents.effective?.id ?? "");
		setModel(seed?.model ?? agents.model ?? "");
		setMissedPolicy(seed?.missedPolicy ?? "run_once");
	}, [open, editing, copyOf, agents.effective?.id, agents.model]);

	const recurrence = useMemo(() => {
		try {
			return recurrenceOf(when);
		} catch {
			return null;
		}
	}, [when]);
	const preview = useSchedulePreview(useSettled(recurrence));
	const agent = agents.harnesses.find((h) => h.id === harness);
	const set = (patch: Partial<WhenForm>) =>
		setWhen((w) => ({ ...w, ...patch }));

	const input: ScheduleInput | null =
		recurrence && name.trim() && serviceId && brief.trim() && harness
			? {
					name: name.trim(),
					serviceId,
					runbook: runbook.trim() || null,
					brief: brief.trim(),
					recurrence,
					harness: harness as HarnessId,
					model: model || null,
					effort: editing?.effort ?? null,
					missedPolicy,
					catchUpMinutes: editing?.catchUpMinutes ?? CATCH_UP_MINUTES,
				}
			: null;

	const save = async () => {
		if (!input) return;
		setError(null);
		try {
			if (editing)
				await update.mutateAsync({
					id: editing.id,
					revision: editing.revision,
					schedule: input,
				});
			else await create.mutateAsync(input);
			onOpenChange(false);
		} catch (e) {
			setError(getErrorMessage(e));
		}
	};

	const serviceName = services.find((s) => s.id === serviceId)?.name;
	const zone = when.timezone;
	const label = "mb-1.5 block text-meta text-text-3";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				size="lg"
				className="flex h-[min(680px,80dvh)] flex-col overflow-hidden max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:rounded-none"
				data-testid="schedule-dialog"
			>
				<DialogHeader>
					<DialogTitle>
						{editing ? "Edit schedule" : "New schedule"}
					</DialogTitle>
				</DialogHeader>

				<div className="-mx-5 grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-5 pb-2">
					<div>
						<Label htmlFor="sch-name" className="mb-1.5 block">
							Name
						</Label>
						<Input
							id="sch-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Morning check of checkout-api"
						/>
					</div>

					<section className="grid gap-2.5">
						<h3 className="text-heading">What it runs</h3>
						<div className="grid gap-2.5 sm:grid-cols-2">
							<div>
								<Label className={label} htmlFor="sch-service">
									Check this service
								</Label>
								<Select value={serviceId} onValueChange={setServiceId}>
									<SelectTrigger id="sch-service">
										<SelectValue placeholder="Pick a service" />
									</SelectTrigger>
									<SelectContent>
										{services.map((s) => (
											<SelectItem key={s.id} value={s.id}>
												{s.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div>
								<Label className={label} htmlFor="sch-runbook">
									Follow a runbook (optional)
								</Label>
								<Input
									id="sch-runbook"
									value={runbook}
									onChange={(e) => setRunbook(e.target.value)}
									placeholder="docs/runbooks/morning.md"
								/>
							</div>
						</div>
						<div>
							<Label className={label} htmlFor="sch-brief">
								Brief for the agent
							</Label>
							<Textarea
								id="sch-brief"
								rows={3}
								value={brief}
								onChange={(e) => setBrief(e.target.value)}
							/>
						</div>
						<p className="text-meta text-text-3">
							If the agent finds a likely cause, PrismaLens opens an incident on{" "}
							{serviceName ?? "the service"} with the report, or adds it to one
							already open there. Otherwise the run is kept in this schedule's
							history.
						</p>
					</section>

					<section className="grid gap-2.5">
						<h3 className="text-heading" id="sch-when">
							When
						</h3>
						<fieldset className="flex flex-wrap gap-1 rounded-control bg-surface-1 p-1">
							<legend className="sr-only">How often</legend>
							{PRESETS.map(([key, text]) => (
								<button
									key={key}
									type="button"
									aria-pressed={when.preset === key}
									onClick={() => set({ preset: key })}
									className={cn(
										"min-h-8 flex-1 rounded-control px-2 text-body whitespace-nowrap text-text-2 max-sm:min-h-11",
										when.preset === key && "bg-surface-3 text-text-1",
									)}
								>
									{text}
								</button>
							))}
						</fieldset>

						{when.preset === "cron" && (
							<div>
								<Label className={label} htmlFor="sch-cron">
									Cron expression
								</Label>
								<Input
									id="sch-cron"
									className="font-mono"
									value={when.cron}
									onChange={(e) => set({ cron: e.target.value })}
								/>
								<p className="mt-1.5 text-meta text-text-3">
									Five fields: minute, hour, day of month, month, day of week.
								</p>
							</div>
						)}
						{when.preset === "hours" && (
							<div className="grid gap-2.5 sm:grid-cols-2">
								<div>
									<Label className={label} htmlFor="sch-every">
										Every
									</Label>
									<Select
										value={String(when.everyHours)}
										onValueChange={(v) => set({ everyHours: Number(v) })}
									>
										<SelectTrigger id="sch-every">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{HOURS.map((h) => (
												<SelectItem key={h} value={String(h)}>
													{h === 1 ? "1 hour" : `${h} hours`}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div>
									<Label className={label} htmlFor="sch-start">
										Starting at
									</Label>
									<Input
										id="sch-start"
										type="time"
										value={when.startAt}
										onChange={(e) => set({ startAt: e.target.value })}
									/>
								</div>
							</div>
						)}
						{(when.preset === "daily" ||
							when.preset === "weekdays" ||
							when.preset === "weekly") && (
							<div className="grid gap-2.5 sm:grid-cols-2">
								<div>
									<Label className={label} htmlFor="sch-time">
										At
									</Label>
									<Input
										id="sch-time"
										type="time"
										value={when.time}
										onChange={(e) => set({ time: e.target.value })}
									/>
								</div>
								<div>
									<Label className={label} htmlFor="sch-zone">
										Time zone
									</Label>
									<Select
										value={zone}
										onValueChange={(v) => set({ timezone: v })}
									>
										<SelectTrigger id="sch-zone">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{zones(zone).map((z) => (
												<SelectItem key={z} value={z}>
													{z === HOST_ZONE && canSetHostZone
														? `${z} (this computer)`
														: z}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
						)}
						{when.preset === "weekly" && (
							<fieldset className="flex gap-1">
								<legend className="sr-only">Days</legend>
								{DAYS.map(([d, short]) => {
									const on = when.days.includes(d);
									return (
										<button
											key={d}
											type="button"
											aria-pressed={on}
											aria-label={DAY_NAMES[d]}
											onClick={() =>
												set({
													days: on
														? when.days.filter((x) => x !== d)
														: [...when.days, d],
												})
											}
											className={cn(
												"size-9 rounded-full text-meta max-sm:size-11",
												on
													? "bg-accent-solid text-accent-fg"
													: "bg-surface-1 text-text-2",
											)}
										>
											{short}
										</button>
									);
								})}
							</fieldset>
						)}

						<div
							aria-live="polite"
							className="rounded-control bg-surface-1 px-3.5 py-3 text-body"
							data-testid="schedule-preview"
						>
							{preview.data?.error ? (
								<span className="text-danger">{preview.data.error}</span>
							) : preview.data?.description ? (
								<>
									<span className="font-semibold">
										{preview.data.description}
									</span>
									{recurrence?.type === "cron" && (
										<span className="text-text-2">, {zone} time.</span>
									)}
									<div className="text-meta text-text-2">
										{nextRunsText(
											preview.data.next,
											recurrence?.type === "cron" ? zone : HOST_ZONE,
										)}
									</div>
									{preview.data.dstNote && (
										<div className="mt-1 text-meta text-text-2">
											{preview.data.dstNote}
										</div>
									)}
								</>
							) : (
								<span className="text-text-3">Pick when it runs.</span>
							)}
						</div>
					</section>

					<section className="grid gap-2.5">
						<h3 className="text-heading">Agent</h3>
						<div>
							<ModelChip
								harness={agent}
								model={model}
								side="bottom"
								className="bg-surface-1"
								onPick={(h, id) => {
									setHarness(h.id);
									setModel(id);
								}}
							/>
						</div>
						<p className="rounded-control bg-surface-1 px-3 py-2.5 text-meta text-text-2">
							Runs with Auto access, like runs an alert starts. The agent may
							run commands and edit files its own Auto mode allows without
							asking. Nobody is there to answer, so anything it asks permission
							for is declined, and the report says what it could not do.
						</p>
					</section>

					<section className="grid gap-1">
						<h3 className="text-heading" id="sch-missed">
							If PrismaLens was asleep or off at that time
						</h3>
						<RadioGroup
							aria-labelledby="sch-missed"
							value={missedPolicy}
							onValueChange={(v) => setMissedPolicy(v as "run_once" | "skip")}
						>
							<label
								htmlFor="sch-run-once"
								className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-control px-2 py-2 hover:bg-surface-1"
							>
								<RadioGroupItem
									id="sch-run-once"
									value="run_once"
									className="mt-0.5 size-4 shrink-0 self-start"
								/>
								<span>
									<span className="block text-body">
										Run once when it is back
									</span>
									<span className="block text-meta text-text-3">
										Only if it is back within 6 hours. Several missed runs still
										make one run.
									</span>
								</span>
							</label>
							<label
								htmlFor="sch-skip"
								className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-control px-2 py-2 hover:bg-surface-1"
							>
								<RadioGroupItem
									id="sch-skip"
									value="skip"
									className="mt-0.5 size-4 shrink-0 self-start"
								/>
								<span>
									<span className="block text-body">Skip it</span>
									<span className="block text-meta text-text-3">
										The history shows it was missed. The next run is at the
										usual time.
									</span>
								</span>
							</label>
						</RadioGroup>
					</section>

					<section className="grid gap-2">
						<h3 className="text-heading">If the previous run is still going</h3>
						<p className="rounded-control bg-surface-1 px-3 py-2.5 text-meta text-text-2">
							This run is skipped, and the history says why. A schedule never
							runs twice at once.
						</p>
					</section>

					{error && (
						<p className="text-meta text-danger" role="alert">
							{error}
						</p>
					)}
				</div>

				<DialogFooter className="shrink-0 pt-3">
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						disabled={!input || create.isPending || update.isPending}
						onClick={save}
					>
						{editing ? "Save" : "Create schedule"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
