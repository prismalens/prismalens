// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useSyncExternalStore } from "react";
import { appearanceTranscriptView } from "@/components/settings/appearance.settings";
import {
	onPersonSettings,
	readPersonSetting,
	writePersonSetting,
} from "./person-settings";

/** Focus, Standard or Full: how much of a thread shows folded (#1101 category 12 item 6). */
export type TranscriptView =
	(typeof appearanceTranscriptView.options)[number]["value"];

const VIEWS = appearanceTranscriptView.options.map((o) => o.value);
const KEY = appearanceTranscriptView.key;
const DEFAULT = VIEWS[0];

let current: TranscriptView | null = null;
const listeners = new Set<() => void>();

function read(): TranscriptView {
	const v = readPersonSetting(KEY);
	return (VIEWS as readonly string[]).includes(v ?? "")
		? (v as TranscriptView)
		: DEFAULT;
}

function get(): TranscriptView {
	current ??= typeof window === "undefined" ? DEFAULT : read();
	return current;
}

// The server's copy wins once it loads: one level per person across devices.
if (typeof window !== "undefined")
	onPersonSettings(() => {
		const next = read();
		if (next === current) return;
		current = next;
		listeners.forEach((l) => {
			l();
		});
	});

/** Saved for the person on the server, cached in this browser (`scope: "person"`). */
export function setTranscriptView(v: TranscriptView): void {
	current = v;
	writePersonSetting(KEY, v);
	listeners.forEach((l) => {
		l();
	});
}

const switched = new Set<(v: TranscriptView) => void>();

/** Hears each switch made in this tab, so the header can say the new level (#1101 cat 12.6). */
export function onTranscriptViewSwitch(
	l: (v: TranscriptView) => void,
): () => void {
	switched.add(l);
	return () => switched.delete(l);
}

/** The next level in the setting's order, for the switch key. */
export function nextTranscriptView(): TranscriptView {
	const v = VIEWS[(VIEWS.indexOf(get()) + 1) % VIEWS.length] as TranscriptView;
	setTranscriptView(v);
	switched.forEach((l) => {
		l(v);
	});
	return v;
}

/** A level's name, from the setting's options. */
export const transcriptViewLabel = (v: TranscriptView): string =>
	appearanceTranscriptView.options.find((o) => o.value === v)?.label ?? v;

export function useTranscriptView(): TranscriptView {
	return useSyncExternalStore(
		(l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		get,
		() => DEFAULT,
	);
}
