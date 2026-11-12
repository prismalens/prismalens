// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Settings, Notifications (#1101 category 4): how threads reach the operator in
 * the app and the OS. The choices are the operator's, on every device; the browser
 * permission is this browser's own.
 */
import {
	NOTIFY_MODES,
	type NotifyMode,
	type NotifyPrefs,
} from "@prismalens/contracts";
import { useId, useState } from "react";
import { MutationError } from "@/components/shared/MutationError";
import { Pool } from "@/components/shared/Row";
import { SettingGroup, SettingRow } from "@/components/shared/SettingRow";
import { StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	type PermissionState,
	permissionWords,
	useNotificationPermission,
} from "@/lib/attention/permission";
import { playNeedsYou } from "@/lib/attention/sound";
import {
	useNotifyPrefs,
	useSetNotifyPrefs,
} from "@/lib/attention/use-attention";

const MODE_WORD: Record<NotifyMode, string> = {
	off: "Off",
	notifications: "Notifications",
	sound: "Sound",
	both: "Notifications and sound",
};

export function NotifyChoices() {
	const prefs = useNotifyPrefs();
	const save = useSetNotifyPrefs();
	const [permission, request] = useNotificationPermission();
	return (
		<>
			<NotifyChoicesView
				prefs={prefs}
				onChange={(p) => save.mutate(p)}
				saving={save.isPending}
				permission={permission}
				onAllow={() => void request()}
			/>
			<MutationError error={save.error} className="mt-2" />
		</>
	);
}

/** The page from its inputs, for the gallery and tests. */
export function NotifyChoicesView({
	prefs,
	onChange,
	saving,
	permission,
	onAllow,
}: {
	prefs: NotifyPrefs;
	onChange: (p: NotifyPrefs) => void;
	saving?: boolean;
	permission: PermissionState;
	onAllow: () => void;
}) {
	const modeId = useId();
	const ids = {
		needs: useId(),
		finished: useId(),
		failed: useId(),
		when: useId(),
	};
	const perm = permissionWords(permission);
	const [tested, setTested] = useState<string | null>(null);
	const sends = prefs.mode === "notifications" || prefs.mode === "both";
	const sounds = prefs.mode === "sound" || prefs.mode === "both";
	const test = () => {
		if (sounds) playNeedsYou();
		if (!sends) {
			setTested(sounds ? "Played the sound." : "Notifications are off.");
			return;
		}
		if (permission !== "granted") {
			setTested("Allow notifications first.");
			return;
		}
		try {
			new Notification("Test from PrismaLens", {
				body: "Threads that need you will look like this.",
				tag: "prismalens-test",
				icon: "/favicon.svg",
			});
			setTested("Sent. Check the corner of your screen.");
		} catch {
			setTested("This browser refused it.");
		}
	};
	return (
		<SettingGroup title="Threads" testId="notify-choices">
			<Pool>
				<SettingRow
					label={<span id={modeId}>Notify me with</span>}
					description="Applies on every device you open PrismaLens on."
				>
					<Select
						value={prefs.mode}
						onValueChange={(v) => onChange({ ...prefs, mode: v as NotifyMode })}
						disabled={saving}
					>
						<SelectTrigger
							aria-labelledby={modeId}
							className="w-52"
							data-testid="notify-mode"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{NOTIFY_MODES.map((m) => (
								<SelectItem key={m} value={m}>
									{MODE_WORD[m]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingRow>
				<SettingRow
					label={<label htmlFor={ids.needs}>A thread needs you</label>}
					description="An approval, a question, a limit or a blocked agent. The only events with a sound."
				>
					<Switch
						id={ids.needs}
						checked={prefs.events.needsYou}
						onCheckedChange={(on) =>
							onChange({ ...prefs, events: { ...prefs.events, needsYou: on } })
						}
						data-testid="notify-needs-you"
					/>
				</SettingRow>
				<SettingRow
					label={<label htmlFor={ids.finished}>A thread finished</label>}
					description="Only threads you started or chose to watch. A child thread's finish counts toward its parent."
				>
					<Switch
						id={ids.finished}
						checked={prefs.events.finished}
						onCheckedChange={(on) =>
							onChange({ ...prefs, events: { ...prefs.events, finished: on } })
						}
						data-testid="notify-finished"
					/>
				</SettingRow>
				<SettingRow label={<label htmlFor={ids.failed}>A thread failed</label>}>
					<Switch
						id={ids.failed}
						checked={prefs.events.failed}
						onCheckedChange={(on) =>
							onChange({ ...prefs, events: { ...prefs.events, failed: on } })
						}
						data-testid="notify-failed"
					/>
				</SettingRow>
				<SettingRow
					label={<label htmlFor={ids.when}>Also while I'm looking</label>}
					description="Off: only while PrismaLens is in the background. Never for the thread on your screen."
				>
					<Switch
						id={ids.when}
						checked={prefs.when === "always"}
						onCheckedChange={(on) =>
							onChange({ ...prefs, when: on ? "always" : "unfocused" })
						}
						data-testid="notify-when"
					/>
				</SettingRow>
				<SettingRow
					label="This browser"
					description={perm.hint}
					testId="notify-permission"
				>
					<span className="flex items-center gap-2">
						<StateWord tone={perm.tone} data-state={permission}>
							{perm.word}
						</StateWord>
						{permission === "default" && (
							<Button
								variant="secondary"
								size="sm"
								onClick={onAllow}
								data-testid="notify-allow"
							>
								Allow
							</Button>
						)}
					</span>
				</SettingRow>
				<SettingRow
					label="Send a test"
					description={
						tested ?? "Shows one notification now, with its sound if on."
					}
				>
					<Button
						variant="secondary"
						size="sm"
						onClick={test}
						disabled={prefs.mode === "off"}
						data-testid="notify-test"
					>
						Send a test
					</Button>
				</SettingRow>
			</Pool>
			<ul
				className="mt-3 flex list-disc flex-col gap-1 pl-5 text-meta text-text-2"
				data-testid="notify-limits"
			>
				<li>
					Notifications show while PrismaLens is open in a browser tab, on HTTPS
					or localhost.
				</li>
				<li>
					On an iPhone or iPad they need PrismaLens added to the Home Screen.
				</li>
				<li>
					No outside service carries them: your browser shows them, with text
					from your own PrismaLens.
				</li>
				<li>Phone push to a closed app is not on yet.</li>
			</ul>
		</SettingGroup>
	);
}
