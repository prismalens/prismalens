// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel, HarnessId } from "@prismalens/config/harness";
import type { ThreadStartSubject } from "@prismalens/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
	defaultAccessOf,
	unreadyLine,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import { useStartThread } from "@/lib/api/hooks/use-threads-orpc";
import { uploadThreadAttachment } from "@/lib/attachments";
import { Composer, type ComposerSend } from "./Composer";

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
}: {
	subject: ThreadStartSubject;
	branch: string | null;
}) {
	const choice = useAgentChoice();
	const start = useStartThread();
	const navigate = useNavigate();
	const [picked, setPicked] = useState<Picked>({});
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

	const onSend = async ({ text, files }: ComposerSend) => {
		const draftKey = crypto.randomUUID();
		const uploaded = await Promise.all(
			files.map((f) => uploadThreadAttachment({ draftKey }, f)),
		);
		const started = await start.mutateAsync({
			subject,
			text,
			accessLevel,
			...(picked.harness ? { harness: picked.harness } : {}),
			...(picked.model !== undefined ? { model: picked.model } : {}),
			...(picked.effort !== undefined ? { effort: picked.effort } : {}),
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
			placeholder="Ask or describe a change"
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
			blockedReason={choice.isLoading ? null : unready}
			autoFocus
		/>
	);
}
