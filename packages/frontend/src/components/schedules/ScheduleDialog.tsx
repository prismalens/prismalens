// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel, HarnessId } from "@prismalens/config/harness";
import {
	AUTO_START_ACCESS_LEVEL,
	projectKindOf,
	type Schedule,
	type ScheduleInput,
	type ThreadStartSubject,
	type WhenAsks,
} from "@prismalens/contracts";
import { FileCheck2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAgentChoice } from "@/components/agent/AgentPicker";
import { Composer } from "@/components/thread/Composer";
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
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useRepositories, useServices } from "@/lib/api/hooks";
import {
	useCreateSchedule,
	useSchedulePreview,
	useUpdateSchedule,
} from "@/lib/api/hooks/use-schedules-orpc";
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

function windowText(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m} minute${m === 1 ? "" : "s"}`;
	if (m === 0) return `${h} hour${h === 1 ? "" : "s"}`;
	return `${h} h ${m} min`;
}

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

/** New thread's text and chips, for Repeat… (#1020). */
export interface SchedulePrefill {
	brief: string;
	subject: ThreadStartSubject;
	harness?: HarnessId;
	model?: string;
	effort?: string | null;
	accessLevel?: AccessLevel;
}

/** The subject picker's value: `none`, `project:<id>` or `service:<id>`. */
export function aboutOf(s: {
	serviceId?: string | null;
	repositoryId?: string | null;
}): string {
	return s.repositoryId
		? `project:${s.repositoryId}`
		: s.serviceId
			? `service:${s.serviceId}`
			: "none";
}

function subjectAbout(subject: ThreadStartSubject): string {
	return subject.kind === "project"
		? `project:${subject.repositoryId}`
		: subject.kind === "service"
			? `service:${subject.serviceId}`
			: "none";
}

/** A short name from the text's first line, for a schedule made from New thread. */
export function nameFrom(text: string): string {
	const line = (text.split("\n")[0] ?? "").trim();
	return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}

/**
 * New and Edit schedule (#979, #1020): a saved composer. Above the box what it is about and
 * Report; inside it the text and the agent chips; below, when it runs and when it asks.
 */
export function ScheduleDialog({
	open,
	onOpenChange,
	editing,
	copyOf,
	prefill,
	canSetHostZone,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	editing?: Schedule;
	/** Duplicate: a new schedule that starts from this one's values. */
	copyOf?: Schedule;
	/** Repeat… on New thread: a new schedule that starts from that box. */
	prefill?: SchedulePrefill;
	canSetHostZone: boolean;
}) {
	const agents = useAgentChoice();
	const services = useServices({ limit: 100 }).data?.data ?? [];
	const projects = useRepositories({ limit: 100 }).data?.data ?? [];
	const create = useCreateSchedule();
	const update = useUpdateSchedule();
	const [name, setName] = useState("");
	const [about, setAbout] = useState("none");
	const [runbook, setRunbook] = useState("");
	const [brief, setBrief] = useState("");
	const [when, setWhen] = useState<WhenForm>(defaultWhen(HOST_ZONE));
	const [harness, setHarness] = useState<string>("");
	const [model, setModel] = useState("");
	const [effort, setEffort] = useState<string | null>(null);
	const [accessLevel, setAccessLevel] = useState<AccessLevel | null>(null);
	const [report, setReport] = useState(true);
	const [whenAsks, setWhenAsks] = useState<WhenAsks>("decide");
	const [missedPolicy, setMissedPolicy] = useState<"run_once" | "skip">(
		"run_once",
	);

	// Seeded once per opening: a live refresh of the schedule must not wipe a draft (adversary OBJ-017).
	const seeded = useRef(false);
	useEffect(() => {
		if (!open) {
			seeded.current = false;
			return;
		}
		if (seeded.current) return;
		seeded.current = true;
		const seed = editing ?? copyOf;
		setName(
			editing?.name ??
				(copyOf
					? `${copyOf.name} (copy)`
					: prefill
						? nameFrom(prefill.brief)
						: ""),
		);
		setAbout(
			seed ? aboutOf(seed) : prefill ? subjectAbout(prefill.subject) : "none",
		);
		setRunbook(seed?.runbook ?? "");
		setBrief(seed?.brief ?? prefill?.brief ?? "");
		setWhen(seed ? formOf(seed.recurrence, HOST_ZONE) : defaultWhen(HOST_ZONE));
		setHarness(
			seed ? seed.harness : (prefill?.harness ?? agents.effective?.id ?? ""),
		);
		setModel(seed ? (seed.model ?? "") : (prefill?.model ?? agents.model));
		setEffort(seed ? (seed.effort ?? null) : (prefill?.effort ?? null));
		setAccessLevel(seed?.accessLevel ?? prefill?.accessLevel ?? null);
		setReport(seed?.report ?? true);
		setWhenAsks(seed?.whenAsks ?? "decide");
		setMissedPolicy(seed?.missedPolicy ?? "run_once");
	}, [open, editing, copyOf, prefill, agents.effective?.id, agents.model]);

	// The default agent can load after the dialog opened; fill only what is still empty.
	useEffect(() => {
		if (!open || editing || copyOf || harness || !agents.effective?.id) return;
		setHarness(agents.effective.id);
		setModel((m) => m || agents.model);
	}, [open, editing, copyOf, harness, agents.effective?.id, agents.model]);

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

	const source = editing ?? copyOf;
	const catchUp = source?.catchUpMinutes ?? CATCH_UP_MINUTES;
	const [kind, aboutId = null] = about.split(":");
	const serviceId = kind === "service" ? aboutId : null;
	const repositoryId = kind === "project" ? aboutId : null;
	const project = projects.find((r) => r.id === repositoryId);
	// A Folder project runs only in a thread you start (#1020 R26).
	const folder = !!project && projectKindOf(project) === "folder";
	const level = accessLevel ?? AUTO_START_ACCESS_LEVEL;
	const input = (text: string): ScheduleInput | null =>
		recurrence && name.trim() && text.trim() && harness && !folder
			? {
					name: name.trim(),
					serviceId,
					repositoryId,
					runbook: serviceId ? runbook.trim() || null : null,
					brief: text.trim(),
					recurrence,
					harness: harness as HarnessId,
					model: model || null,
					effort,
					accessLevel,
					report,
					whenAsks,
					missedPolicy,
					catchUpMinutes: catchUp,
				}
			: null;
	const missing = !name.trim()
		? "Name it first"
		: folder
			? "Folder needs git first"
			: !recurrence
				? "Pick when it runs"
				: null;

	const save = async (text: string) => {
		const schedule = input(text);
		if (!schedule) return;
		if (editing)
			await update.mutateAsync({
				id: editing.id,
				revision: editing.revision,
				schedule,
			});
		else await create.mutateAsync(schedule);
		onOpenChange(false);
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
						<Composer
							state="ready"
							onSend={({ text }) => save(text)}
							placeholder="What should it do?"
							text={brief}
							onText={setBrief}
							choice={{ harness: agent, model, effort, accessLevel: level }}
							onChoice={(next) => {
								if (next.harnessId) {
									setHarness(next.harnessId);
									setEffort(null);
								}
								if (next.model !== undefined) setModel(next.model);
								if (next.effort !== undefined) setEffort(next.effort);
								if (next.accessLevel) setAccessLevel(next.accessLevel);
							}}
							sendLabel={editing ? "Save" : "Create schedule"}
							holdSend={!!missing || create.isPending || update.isPending}
							notice={brief.trim() ? (missing ?? undefined) : undefined}
							noFiles
							top={
								<div
									className="flex flex-wrap items-center gap-1.5 px-0.5"
									data-testid="schedule-top"
								>
									<Select value={about} onValueChange={setAbout}>
										<SelectTrigger
											aria-label="Subject"
											className="max-w-64 text-meta"
											data-testid="schedule-subject"
										>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem
												value="none"
												data-testid="schedule-subject-none"
											>
												No project
											</SelectItem>
											{projects.length > 0 && (
												<SelectGroup>
													<SelectLabel>Projects</SelectLabel>
													{projects.map((r) => (
														<SelectItem
															key={r.id}
															value={`project:${r.id}`}
															disabled={projectKindOf(r) === "folder"}
															data-testid={`schedule-subject-project-${r.id}`}
														>
															{r.fullName}
														</SelectItem>
													))}
												</SelectGroup>
											)}
											{services.length > 0 && (
												<SelectGroup>
													<SelectLabel>Services</SelectLabel>
													{services.map((sv) => (
														<SelectItem
															key={sv.id}
															value={`service:${sv.id}`}
															data-testid={`schedule-subject-service-${sv.id}`}
														>
															{sv.name}
														</SelectItem>
													))}
												</SelectGroup>
											)}
										</SelectContent>
									</Select>
									<button
										type="button"
										aria-pressed={report}
										onClick={() => setReport((r) => !r)}
										className={cn(
											"inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-meta transition-colors duration-(--dur-instant)",
											report
												? "bg-surface-3 font-medium text-text-1"
												: "bg-surface-2 text-text-2 hover:text-text-1",
										)}
										data-testid="schedule-report"
									>
										<FileCheck2 aria-hidden className="size-3.5" />
										Report
									</button>
								</div>
							}
						/>
						{serviceId && (
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
						)}
						{serviceId && report && (
							<p className="text-meta text-text-3">
								If the agent finds a likely cause, PrismaLens opens an incident
								on {serviceName ?? "the service"} with the report, or adds it to
								one already open there. Otherwise the run is kept in this
								schedule's history.
							</p>
						)}
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

					<section className="grid gap-1">
						<h3 className="text-heading" id="sch-asks">
							When it asks
						</h3>
						<RadioGroup
							aria-labelledby="sch-asks"
							value={whenAsks}
							onValueChange={(v) => setWhenAsks(v as WhenAsks)}
						>
							{(
								[
									["decide", "Decide for me", "Refuses asks, keeps going"],
									["wait", "Wait for me", "Waits and notifies you"],
								] as const
							).map(([value, title, line]) => (
								<label
									key={value}
									htmlFor={`sch-asks-${value}`}
									className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-control px-2 py-2 hover:bg-surface-1"
								>
									<RadioGroupItem
										id={`sch-asks-${value}`}
										value={value}
										className="mt-0.5 size-4 shrink-0 self-start"
										data-testid={`schedule-asks-${value}`}
									/>
									<span>
										<span className="block text-body">{title}</span>
										<span className="block text-meta text-text-3">{line}</span>
									</span>
								</label>
							))}
						</RadioGroup>
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
										Only if it is back within {windowText(catchUp)}. Several
										missed runs still make one run.
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
				</div>

				<DialogFooter className="shrink-0 pt-3">
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
