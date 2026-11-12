// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AttentionEvent, NotifyPrefs } from "@prismalens/contracts";
import { describe, expect, it } from "vitest";
import {
	decide,
	eventWords,
	notificationText,
	type TabFacts,
} from "./notify-rules.js";

const fixedClock = (_at: string) => "06:12";

function makeEvent(over: Partial<AttentionEvent> = {}): AttentionEvent {
	return {
		id: "event-1",
		threadId: "thread-1",
		kind: "needs_you",
		detail: null,
		resetsAt: null,
		at: "2026-11-12T06:00:00Z",
		readAt: null,
		notify: true,
		silenced: false,
		thread: {
			id: "thread-1",
			title: "Investigation 1",
			kind: "incident",
			parentId: null,
			rootId: null,
			rootTitle: null,
			incident: null,
			cause: null,
			nextCommand: null,
			answer: null,
			status: "working",
			follow: null,
			error: null,
			endReason: null,
		},
		...over,
	};
}

function makePrefs(over: Partial<NotifyPrefs> = {}): NotifyPrefs {
	return {
		mode: "both",
		when: "unfocused",
		events: {
			needsYou: true,
			finished: true,
			failed: true,
		},
		...over,
	};
}

function makeTab(over: Partial<TabFacts> = {}): TabFacts {
	return {
		focused: false,
		viewing: null,
		permission: "granted",
		...over,
	};
}

describe("notify-rules (#1101 category 4)", () => {
	describe("decide", () => {
		it("notify false -> all false", () => {
			const e = makeEvent({ notify: false });
			expect(decide(e, makePrefs(), makeTab())).toEqual({
				toast: false,
				os: false,
				sound: false,
			});
		});

		it("silenced -> all false", () => {
			const e = makeEvent({ silenced: true });
			expect(decide(e, makePrefs(), makeTab())).toEqual({
				toast: false,
				os: false,
				sound: false,
			});
		});

		it("viewing that thread while focused -> all false", () => {
			const e = makeEvent({ threadId: "thread-1" });
			const tab = makeTab({ focused: true, viewing: "thread-1" });
			expect(decide(e, makePrefs(), tab)).toEqual({
				toast: false,
				os: false,
				sound: false,
			});
		});

		it("prefs.events.finished false + finished event -> all false", () => {
			const e = makeEvent({ kind: "finished" });
			const prefs = makePrefs({
				events: { needsYou: true, finished: false, failed: true },
			});
			expect(decide(e, prefs, makeTab())).toEqual({
				toast: false,
				os: false,
				sound: false,
			});
		});

		it("focused, another thread, mode notifications, when unfocused -> {toast:true, os:false, sound:false}", () => {
			const e = makeEvent({ threadId: "thread-2" });
			const prefs = makePrefs({ mode: "notifications", when: "unfocused" });
			const tab = makeTab({ focused: true, viewing: "thread-1" });
			expect(decide(e, prefs, tab)).toEqual({
				toast: true,
				os: false,
				sound: false,
			});
		});

		it("unfocused, granted, mode both, needs_you -> {toast:false, os:true, sound:true}", () => {
			const e = makeEvent({ kind: "needs_you" });
			const prefs = makePrefs({ mode: "both", when: "unfocused" });
			const tab = makeTab({
				focused: false,
				viewing: null,
				permission: "granted",
			});
			expect(decide(e, prefs, tab)).toEqual({
				toast: false,
				os: true,
				sound: true,
			});
		});

		it("unfocused, mode both, finished -> sound false", () => {
			const e = makeEvent({ kind: "finished" });
			const prefs = makePrefs({ mode: "both", when: "unfocused" });
			const tab = makeTab({
				focused: false,
				viewing: null,
				permission: "granted",
			});
			expect(decide(e, prefs, tab)).toEqual({
				toast: false,
				os: true,
				sound: false,
			});
		});

		it("unfocused, permission denied, mode notifications -> os false", () => {
			const e = makeEvent({ kind: "finished" });
			const prefs = makePrefs({ mode: "notifications", when: "unfocused" });
			const tab = makeTab({
				focused: false,
				viewing: null,
				permission: "denied",
			});
			expect(decide(e, prefs, tab)).toEqual({
				toast: false,
				os: false,
				sound: false,
			});
		});

		it("mode off focused another thread -> toast true, os false", () => {
			const e = makeEvent({ threadId: "thread-2" });
			const prefs = makePrefs({ mode: "off" });
			const tab = makeTab({ focused: true, viewing: "thread-1" });
			expect(decide(e, prefs, tab)).toEqual({
				toast: true,
				os: false,
				sound: false,
			});
		});

		it("when always focused another thread granted mode notifications -> os true", () => {
			const e = makeEvent({ threadId: "thread-2" });
			const prefs = makePrefs({ mode: "notifications", when: "always" });
			const tab = makeTab({
				focused: true,
				viewing: "thread-1",
				permission: "granted",
			});
			expect(decide(e, prefs, tab)).toEqual({
				toast: true,
				os: true,
				sound: false,
			});
		});

		it("kind started -> all false", () => {
			const e = makeEvent({ kind: "started" });
			expect(decide(e, makePrefs(), makeTab())).toEqual({
				toast: false,
				os: false,
				sound: false,
			});
		});
	});

	describe("eventWords", () => {
		// a04d92755: Limited names the stop, so the detail is only its one time.
		it("limited with detail usage_limit and resetsAt -> word Limited, detail Resumes 06:12", () => {
			const e = makeEvent({
				kind: "limited",
				detail: "usage_limit",
				resetsAt: "2026-11-12T06:12:00Z",
			});
			expect(eventWords(e, fixedClock)).toEqual({
				word: "Limited",
				detail: "Resumes 06:12",
			});
		});

		it("blocked with detail key_rejected -> word Blocked", () => {
			const e = makeEvent({
				kind: "blocked",
				detail: "key_rejected",
			});
			expect(eventWords(e, fixedClock)).toEqual({
				word: "Blocked",
				detail: "API key rejected",
			});
		});

		it("failed uses thread.cause before thread.answer", () => {
			const e = makeEvent({
				kind: "failed",
				thread: {
					id: "thread-1",
					title: "Fail test",
					kind: "chat",
					parentId: null,
					rootId: null,
					rootTitle: null,
					incident: null,
					cause: "primary cause",
					nextCommand: null,
					answer: "fallback answer",
					status: "failed",
					follow: null,
					error: null,
					endReason: null,
				},
			});
			expect(eventWords(e, fixedClock)).toEqual({
				word: "Failed",
				detail: "primary cause",
			});
		});

		it("started with detail scheduled and no answer -> Scheduled run, It ran on its schedule.", () => {
			const e = makeEvent({
				kind: "started",
				detail: "scheduled",
			});
			expect(eventWords(e, fixedClock)).toEqual({
				word: "Scheduled run",
				detail: "It ran on its schedule.",
			});
		});
	});

	describe("notificationText", () => {
		it("incident thread severity high, cause Pool cut to 5, finished -> title High · Finished: <title>, body Likely cause: Pool cut to 5", () => {
			const e = makeEvent({
				kind: "finished",
				thread: {
					id: "thread-1",
					title: "API outage",
					kind: "incident",
					parentId: null,
					rootId: null,
					rootTitle: null,
					incident: { id: "inc-1", number: 42, severity: "high" },
					cause: "Pool cut to 5",
					nextCommand: null,
					answer: null,
					status: "done",
					follow: null,
					error: null,
					endReason: null,
				},
			});
			expect(notificationText(e, fixedClock)).toEqual({
				title: "High · Finished: API outage",
				body: "Likely cause: Pool cut to 5",
			});
		});

		// 59b901d45: a thread is never "Untitled thread"; an untitled chat is named Chat.
		it("chat thread with null title -> title Finished: Chat", () => {
			const e = makeEvent({
				kind: "finished",
				thread: {
					id: "thread-1",
					title: null,
					kind: "chat",
					parentId: null,
					rootId: null,
					rootTitle: null,
					incident: null,
					cause: null,
					nextCommand: null,
					answer: "Completed successfully",
					status: "done",
					follow: null,
					error: null,
					endReason: null,
				},
			});
			expect(notificationText(e, fixedClock)).toEqual({
				title: "Finished: Chat",
				body: "Completed successfully",
			});
		});
	});
});
