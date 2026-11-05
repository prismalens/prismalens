// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel, HarnessId } from "@prismalens/config/harness";
import type { Severity, ThreadStartSubject } from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useRef, useState } from "react";
import {
	defaultAccessOf,
	unreadyLine,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import { useCreateIncident, useInvestigateIncident } from "@/lib/api/hooks";
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
}: {
	subject: ThreadStartSubject;
	branch: string | null;
	/** Incident on: the message creates an incident at this severity and investigates it. */
	incident?: Severity | null;
	/** With Incident on: keep the text as the incident's description, start no run. */
	note?: boolean;
	top?: ReactNode;
	slash?: SlashCommand[];
}) {
	const choice = useAgentChoice();
	const start = useStartThread();
	const createIncident = useCreateIncident();
	const investigate = useInvestigateIncident();
	const navigate = useNavigate();
	const [picked, setPicked] = useState<Picked>({});
	// The incident a failed send made: a retry of the same text, severity and service
	// investigates it, never makes another; an edited retry makes its own.
	const madeIncident = useRef<{ id: string; sent: string } | null>(null);
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
		const sent = JSON.stringify([
			text,
			severity,
			subject.kind === "service" ? subject.serviceId : null,
		]);
		const id =
			madeIncident.current?.sent === sent
				? madeIncident.current.id
				: (
						await createIncident.mutateAsync({
							title: (text.split("\n")[0] ?? text).slice(0, 120),
							description: text,
							severity,
							...(subject.kind === "service"
								? { serviceId: subject.serviceId }
								: {}),
						})
					).id;
		madeIncident.current = { id, sent };
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
			placeholder={incident ? "What's wrong?" : "Ask or describe a change"}
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
			autoFocus
			top={top}
			slash={slash}
		/>
	);
}
