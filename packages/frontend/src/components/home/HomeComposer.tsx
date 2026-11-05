// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { HarnessId } from "@prismalens/config/harness";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import {
	AccessChip,
	ModelChip,
	unreadyLine,
	useAgentChoice,
} from "@/components/agent/AgentPicker";
import { useActiveIncidents } from "@/components/inbox/use-inbox-data";
import { useSetupProgress } from "@/components/incidents/FirstRunPanel";
import type { DraftChoice } from "@/components/incidents/record-context";
import {
	type ComposerAction,
	ComposerBox,
	type ComposerSend,
} from "@/components/investigation/ComposerBox";
import { boxChoice } from "@/components/overview/OverviewComposer";
import { codeWhere } from "@/components/services/service-detail.utils";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCreateIncident, useServices } from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";
import { uploadAttachment } from "@/lib/attachments";
import { CHAT_TAG } from "@/lib/trigger";
import { AwayStrip } from "./AwayStrip";

const SEND: ComposerAction[] = [
	{ id: "ask", label: "Send", detail: "", needsText: true },
];

/** The thread's title: its first line, cut at a word near 80 characters. */
export function titleOf(text: string): string {
	const line = text.trim().split("\n")[0]?.trim() ?? "";
	if (line.length <= 80) return line;
	const cut = line.slice(0, 80);
	return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : 80)}…`;
}

/**
 * Home on a quiet workspace: one question, one box, one setup line.
 * A thread still needs an incident to live on (#1020 follow-up), so Send
 * makes one from the first line and opens its conversation.
 */
export function HomeComposer() {
	const navigate = useNavigate();
	const { data: servicesPage } = useServices({ limit: 100 });
	const services = servicesPage?.data ?? [];
	const [serviceId, setServiceId] = useState<string | null>(null);
	// Unpicked, the box means the service touched last, preferring one with code (#1020 D7).
	const { incidents } = useActiveIncidents();
	const recent = [...incidents]
		.sort(
			(a, b) =>
				Date.parse(b.updatedAt ?? b.triggeredAt) -
				Date.parse(a.updatedAt ?? a.triggeredAt),
		)
		.map((i) => services.find((s) => s.id === i.serviceId))
		.filter((s): s is (typeof services)[number] => !!s);
	const service =
		services.find((s) => s.id === serviceId) ??
		recent.find((s) => codeWhere(s)) ??
		recent[0] ??
		services.find((s) => codeWhere(s)) ??
		services[0] ??
		null;
	const [draft, setDraft] = useState<DraftChoice>({});
	const { harness, hid, model, accessLevel, now, sent } = boxChoice(
		useAgentChoice(),
		draft,
	);
	const [text, setText] = useState("");
	const create = useCreateIncident();
	const chat = useMutation(orpc.incidents.chat.mutationOptions());
	const unready = harness ? unreadyLine(harness) : "No coding agent yet.";

	const onSend = async ({ text, files }: ComposerSend) => {
		const incident = await create.mutateAsync({
			title: titleOf(text),
			tags: [CHAT_TAG],
			...(service ? { serviceId: service.id } : {}),
		});
		const attachments = await Promise.all(
			files.map((f) => uploadAttachment(incident.id, f)),
		);
		const run = await chat.mutateAsync({
			id: incident.id,
			text,
			...sent,
			...(attachments.length
				? { attachments: attachments.map((a) => a.id) }
				: {}),
		});
		await navigate({
			to: "/incidents/$id/conversation",
			params: { id: incident.id },
			search: { investigation: run.investigationId },
		});
	};

	return (
		<div
			className="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-4 pt-[18vh] pb-12"
			data-testid="home"
		>
			<div className="flex flex-col items-center gap-1">
				<h2 className="text-center text-display text-text-1">
					What should we look into?
				</h2>
				{service && (
					// The service is a quiet choice under the question, so a long name never outweighs it.
					<p className="flex items-center gap-1 text-body text-text-3">
						in
						<ServicePicker
							services={services}
							value={service}
							onPick={setServiceId}
						/>
					</p>
				)}
			</div>
			{!service && servicesPage && (
				<p className="-mt-2 self-center text-body text-text-3">
					Ask now, or{" "}
					<Link
						to="/services"
						search={{ add: "1" }}
						className="inline-flex min-h-6 items-center text-text-2 hover:text-text-1 hover:underline"
						data-testid="home-add-folder"
					>
						add a service
					</Link>{" "}
					so the agent can read its code.
				</p>
			)}
			<ComposerBox
				actions={SEND}
				action="ask"
				onAction={() => {}}
				chips={
					<>
						<ModelChip
							harness={harness}
							model={model}
							disabled={!!unready}
							onPick={(h, m) =>
								setDraft(
									h.id === hid
										? { ...now, model: m }
										: { harness: h.id as HarnessId, model: m },
								)
							}
						/>
						<AccessChip
							harness={harness}
							level={accessLevel}
							disabled={!!unready}
							onLevel={(l) => setDraft({ ...now, accessLevel: l })}
						/>
					</>
				}
				onSend={onSend}
				placeholder="Ask anything"
				text={text}
				setText={setText}
				agent={{
					label: harness?.label ?? "The agent",
					images:
						harness?.checked?.outcome === "answers-acp"
							? harness.checked.images
							: null,
				}}
				isPending={create.isPending || chat.isPending}
				blockedReason={unready ?? undefined}
				autoFocus
			/>
			<SetupHint service={service} />
			<AwayStrip />
		</div>
	);
}

function ServicePicker({
	services,
	value,
	onPick,
}: {
	services: { id: string; name: string }[];
	value: { id: string; name: string };
	onPick: (id: string) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				className="inline-flex min-h-6 max-w-[28rem] items-center gap-1 rounded-control px-1.5 text-text-1 outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent"
				data-testid="home-service"
			>
				<span className="truncate">{value.name}</span>
				<ChevronDown className="size-4 self-center text-text-3" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="center">
				<DropdownMenuRadioGroup value={value.id} onValueChange={onPick}>
					{services.map((s) => (
						<DropdownMenuRadioItem key={s.id} value={s.id}>
							{s.name}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link to="/services" search={{ add: "1" }}>
						Add a service
					</Link>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * One quiet line for the first missing step; gone once setup is done. The
 * code step is about the picked service only; alerts, an optional trigger, come last.
 */
function SetupHint({
	service,
}: {
	service: { id: string; name: string } | null;
}) {
	const p = useSetupProgress();
	if (!p.loaded) return null;
	const noCode =
		service && !codeWhere(service as Parameters<typeof codeWhere>[0]);
	const link = !p.steps.agent ? (
		<Link to="/settings" search={{ tab: "agent" }}>
			Set up
		</Link>
	) : noCode && service ? (
		<Link to="/services/$id" params={{ id: service.id }}>
			Link code
		</Link>
	) : !p.alertsIn ? (
		<Link to="/alerts">Connect</Link>
	) : null;
	if (!link) return null;
	const what = !p.steps.agent
		? "No agent ready."
		: noCode && service
			? "The agent can't read this service's code yet."
			: "Alerts not connected.";
	return (
		<p
			className="text-center text-body text-text-2 [&_a]:inline-flex [&_a]:min-h-6 [&_a]:items-center [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2"
			data-testid="setup-line"
		>
			{what} {link}
		</p>
	);
}
