// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel, HarnessId } from "@prismalens/config/harness";
import type {
	HelperPlace,
	Severity,
	ThreadStartSubject,
} from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useRef, useState } from "react";
import {
	defaultAccessOf,
	unreadyLine,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import type { SchedulePrefill } from "@/components/schedules/ScheduleDialog";
import {
	useCreateIncident,
	useInvestigateIncident,
	useUpdateIncident,
} from "@/lib/api/hooks";
import { useStartThread } from "@/lib/api/hooks/use-threads-orpc";
import { uploadAttachment, uploadThreadAttachment } from "@/lib/attachments";
import { Composer, type ComposerSend, type SlashCommand } from "./Composer";

interface Picked {
	harness?: HarnessId;
	model?: string;
	effort?: string | null;
	accessLevel?: AccessLevel;
}

/**
 * The shared composer on a new thread (#1020): the first message starts it on `subject`,
 * then the thread's page opens. Files ride under a draft key until the run claims them.
 */
export function NewThread({
	subject,
	branch,
	incident = null,
	note = false,
	top,
	slash,
	place,
	placeholder,
	autoFocus = true,
	onRepeat,
}: {
	subject: ThreadStartSubject;
	branch: string | null;
	/** Incident on: the message creates an incident at this severity and investigates it. */
	incident?: Severity | null;
	/** With Incident on: keep the text as the incident's description, start no run. */
	note?: boolean;
	top?: ReactNode;
	slash?: SlashCommand[];
	/** A no-subject helper's empty page; the server words its context, never the page's data. */
	place?: HelperPlace;
	placeholder?: string;
	autoFocus?: boolean;
	/** Repeat… beside Send: this box, as a new schedule's form (#1020). */
	onRepeat?: (draft: SchedulePrefill) => void;
}) {
	const choice = useAgentChoice();
	const start = useStartThread();
	const createIncident = useCreateIncident();
	const investigate = useInvestigateIncident();
	const updateIncident = useUpdateIncident();
	const navigate = useNavigate();
	const [picked, setPicked] = useState<Picked>({});
	// The incident a failed send already made: a retry investigates it, never makes another.
	const madeIncident = useRef<{
		id: string;
		fields: {
			title: string;
			description: string;
			severity: Severity;
			serviceId?: string;
		};
	} | null>(null);
	const harness =
		choice.harnesses.find((h) => h.id === picked.harness) ?? choice.effective;
	const hid = harness?.id as HarnessId | undefined;
	const model =
		picked.model ?? (hid ? (choice.models[hid] ?? choice.model) : "") ?? "";
	const effort =
		picked.effort !== undefined
			? picked.effort
			: hid
				? (choice.efforts[hid] ?? null)
				: null;
	const accessLevel =
		picked.accessLevel ?? defaultAccessOf(harness, choice.axes).level.level;
	const unready = harness ? unreadyLine(harness) : null;

	const run = {
		accessLevel,
		...(picked.harness ? { harness: picked.harness } : {}),
		...(picked.model !== undefined ? { model: picked.model } : {}),
		...(picked.effort !== undefined ? { effort: picked.effort } : {}),
	};

	/** The text is the brief; its first line names the incident. */
	const sendIncident = async (
		severity: Severity,
		{ text, files }: ComposerSend,
	) => {
		const fields = {
			title: (text.split("\n")[0] ?? text).slice(0, 120),
			description: text,
			severity,
			...(subject.kind === "service" ? { serviceId: subject.serviceId } : {}),
		};
		// A retry may carry edited words: they go onto the incident it reuses (#1020).
		// A service can be set on an incident, never moved: another service makes a new one,
		// and the kept one stays until that create succeeds, so a retry for the first still reuses it.
		const kept =
			madeIncident.current &&
			!(
				madeIncident.current.fields.serviceId &&
				madeIncident.current.fields.serviceId !== fields.serviceId
			)
				? madeIncident.current
				: null;
		if (kept) {
			const changed = Object.fromEntries(
				Object.entries(fields).filter(
					([k, v]) => kept.fields[k as keyof typeof fields] !== v,
				),
			);
			if (Object.keys(changed).length)
				await updateIncident.mutateAsync({ id: kept.id, ...changed });
		}
		const id = kept?.id ?? (await createIncident.mutateAsync(fields)).id;
		madeIncident.current = { id, fields };
		const uploaded = await Promise.all(
			files.map((f) => uploadAttachment(id, f)),
		);
		if (note) {
			madeIncident.current = null;
			await navigate({ to: "/incidents/$id", params: { id } });
			return;
		}
		const started = await investigate.mutateAsync({
			id,
			brief: text,
			...run,
			...(uploaded.length ? { attachments: uploaded.map((a) => a.id) } : {}),
		});
		madeIncident.current = null;
		await navigate({
			to: "/incidents/$id/conversation",
			params: { id },
			search: { investigation: started.investigationId },
		});
	};

	const onSend = async (send: ComposerSend) => {
		if (incident) return sendIncident(incident, send);
		const { text, files } = send;
		const draftKey = crypto.randomUUID();
		const uploaded = await Promise.all(
			files.map((f) => uploadThreadAttachment({ draftKey }, f)),
		);
		const started = await start.mutateAsync({
			subject,
			text,
			...(place ? { place } : {}),
			...run,
			...(uploaded.length
				? { draftKey, attachments: uploaded.map((a) => a.id) }
				: {}),
		});
		await navigate({
			to: "/threads/$id",
			params: { id: started.investigationId },
		});
	};

	return (
		<Composer
			state="ready"
			onSend={onSend}
			placeholder={
				placeholder ?? (incident ? "What's wrong?" : "Ask or describe a change")
			}
			choice={{ harness, model, effort, accessLevel }}
			onChoice={(next) =>
				setPicked((p) => ({
					...p,
					...(next.harnessId
						? { harness: next.harnessId, effort: undefined }
						: {}),
					...(next.model !== undefined ? { model: next.model } : {}),
					...(next.effort !== undefined ? { effort: next.effort } : {}),
					...(next.accessLevel ? { accessLevel: next.accessLevel } : {}),
				}))
			}
			branch={branch}
			blockedReason={choice.isLoading || (incident && note) ? null : unready}
			autoFocus={autoFocus}
			top={top}
			slash={slash}
			{...(onRepeat && !incident
				? {
						onRepeat: (text: string) =>
							onRepeat({
								brief: text,
								subject,
								...(hid ? { harness: hid } : {}),
								model,
								effort,
								accessLevel,
							}),
					}
				: {})}
		/>
	);
}
