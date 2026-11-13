// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type AccessLevel,
	HARNESS_REGISTRY,
	type HarnessId,
} from "@prismalens/config/harness";
import {
	type ComposerScope,
	DRAFT_TEXT_MAX_CHARS,
	type HarnessStatus,
	type ReferenceHit,
	scopeThreadId,
	shouldFoldPaste,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import {
	GitBranch,
	Paperclip,
	Play,
	Plus,
	Repeat,
	Square,
	X,
} from "lucide-react";
import {
	type ClipboardEvent,
	type KeyboardEvent,
	type MutableRefObject,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	AccessChip,
	EffortChip,
	effortLevels,
	ModelChip,
} from "@/components/agent/AgentPicker";
import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "@/components/ai/prompt-input";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useCompactThread } from "@/lib/api/hooks/use-investigations-orpc";
import {
	useComposerClient,
	useReferenceSearch,
	useReferenceUse,
	useResolveLinks,
} from "@/lib/api/hooks/use-references-orpc";
import { attachRefusal, downscaleImage } from "@/lib/attachments";
import { composerKeyAction } from "@/lib/composer-keys";
import {
	envelopeOf,
	type SendEnvelope,
	type SendReceipt,
	type SendResult,
} from "@/lib/composer-send";
import { openContextMeter } from "@/lib/context-meter";
import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";
import {
	ComposerMenu,
	groupHits,
	menuRows,
	optionId,
} from "./composer/ComposerMenu";
import {
	CommandChip,
	type CommandChipItem,
	ConflictLine,
	FileChip,
	type FileChipItem,
	QuoteChipView,
	RefChip,
	type RefChipItem,
} from "./composer/chips";
import { menuResult } from "./composer/commands";
import { dropFile, keepFile, keptFile } from "./composer/draft-store";
import {
	type NewThreadSeed,
	onQuote,
	openNewThread,
	type QuoteChip,
} from "./composer/quote";
import { activeTrigger, removeTrigger } from "./composer/trigger";
import { useComposerDraft } from "./composer/use-composer-draft";

/** What the box holds now, for a page that reads it without sending (a handoff). */
export interface ComposerSend {
	text: string;
	files: File[];
}

/** A send's answer: the box clears only on `sent` (lib/composer-send.ts). */
export type ComposerReply = SendResult | SendReceipt;

/** Chosen beside the text by a lane (quotes, references, the saved draft); merged into each send. */
export type EnvelopeExtras = Partial<
	Pick<SendEnvelope, "quotes" | "references" | "draftScope" | "draftRev">
>;

/** What the one action button does: Send, Stop while the agent works, Resume a cut-off run. */
export type ComposerState = "ready" | "live" | "interrupted";

export interface ComposerChoice {
	harness: HarnessStatus | undefined;
	model: string;
	effort: string | null;
	accessLevel: AccessLevel;
}

/** A page's own `/` action; the menu also holds app commands and the agent's advertised ones (#1024). */
export interface SlashCommand {
	id: string;
	label: string;
	/** One quiet line: what it does and where the result goes. */
	detail?: string;
	run: () => void;
}

/** What Send does when the box can do more than one thing, shown above the box. */
export interface ComposerMode {
	id: string;
	label: string;
	/** Back to the box's first way to send; absent when this is it. */
	onClear?: () => void;
}

/** One thing the box's Send can do: Ask, Investigate, Note, Continue Run 2, Message. */
export interface ComposerAction {
	id: string;
	label: string;
	/** One line: what happens and where the result goes. */
	detail: string;
	/** Send does nothing on an empty box. */
	needsText: boolean;
}

/**
 * A box with several actions shows the current one above it and offers the rest
 * under `/` (#1020); with one action, the placeholder says what Send does.
 */
export function actionProps(
	actions: ComposerAction[],
	value: string,
	onAction: (id: string) => void,
): Pick<ComposerProps, "mode" | "slash" | "emptySend" | "sendLabel"> {
	const current = actions.find((a) => a.id === value) ?? actions[0];
	const first = actions[0];
	if (!current || !first) return {};
	const base = {
		emptySend: !current.needsText,
		sendLabel: current.label,
	};
	if (actions.length < 2) return base;
	return {
		...base,
		mode: {
			id: current.id,
			label: current.label,
			...(current.id !== first.id ? { onClear: () => onAction(first.id) } : {}),
		},
		slash: actions
			.filter((a) => a.id !== current.id)
			.map((a) => ({
				id: a.id,
				label: a.label,
				detail: a.detail,
				run: () => onAction(a.id),
			})),
	};
}

export interface ComposerProps {
	state: ComposerState;
	onSend: (
		envelope: SendEnvelope,
		now: boolean,
	) => Promise<ComposerReply> | ComposerReply;
	/** Merged into every envelope this box sends. */
	extras?: EnvelopeExtras;
	/** The page's footer slot, under the box. */
	footer?: ReactNode;
	onStop?: () => void;
	stopping?: boolean;
	onResume?: () => void;
	resuming?: boolean;
	placeholder: string;
	choice: ComposerChoice;
	onChoice: (next: Partial<ComposerChoice> & { harnessId?: HarnessId }) => void;
	/** A follow-up keeps the run's agent and level: the chips show them, read-only. */
	locked?: boolean;
	/** The branch a new thread starts from, above the box; a follow-up's is in the status box. */
	branch?: string | null;
	/** The agent's asks, docked on the box. */
	dock?: ReactNode;
	/** Why nothing can be sent now. */
	blockedReason?: string | null;
	/** A dock above already says why and offers the fix: the box only greys out. */
	blockedQuiet?: boolean;
	autoFocus?: boolean;
	/** A row above the box: a new thread's subject and Incident toggle. */
	top?: ReactNode;
	/** What `/` offers; the text typed after it narrows the list. */
	slash?: SlashCommand[];
	/** What Send does now, when the box can do more than one thing. */
	mode?: ComposerMode;
	/** The text, when the page keeps it (a draft survives a remount). */
	text?: string;
	onText?: (text: string) => void;
	/** Files a prefilled draft starts with, and each change to them. */
	initialFiles?: File[];
	onFilesChange?: (files: File[]) => void;
	/** Kept current with what is in the box. */
	boxRef?: MutableRefObject<ComposerSend | null>;
	/** Access is shown read-only with this reason; the agent chips stay live. */
	accessHint?: string;
	/** The message goes to no agent (a note): no agent chips. */
	agentless?: boolean;
	/** Send works on an empty box (an investigation's brief is optional). */
	emptySend?: boolean;
	sendLabel?: string;
	/** The run cannot take a message: one way on instead of the box, with the server's reason. */
	ended?: { onNewRun: () => void; onRecheck?: () => void; reason?: string };
	/** A line under the box that leaves it usable. */
	notice?: string;
	/** Send waits, e.g. on a handoff preview. */
	holdSend?: boolean;
	pending?: boolean;
	/** A message the run ended before taking, offered as a note. */
	undeliverable?: string | null;
	onSaveAsNote?: (text: string) => void;
	/** Lines above the box: where the result goes. */
	above?: ReactNode;
	/** A new conversation's box floats in the middle of the page. */
	floating?: boolean;
	/** The box takes no files (a schedule's saved text): no attach, no pasted files. */
	noFiles?: boolean;
	/** Beside Send: save this text as a schedule instead (#1020). */
	onRepeat?: (text: string) => void;
	/** Each change focuses the box with the caret at the end, e.g. after a quote fills it. */
	focusSignal?: number;
	/** Where the draft is kept (#1024); absent or null keeps none. */
	scope?: ComposerScope | null;
	/** What a new thread's box starts with: a quote, a linked thread. */
	seed?: NewThreadSeed | null;
}

type Draft = FileChipItem;

const NO_HISTORY: string[] = [];

const without = (id: string) => (h: ReadonlySet<string>) => {
	const next = new Set(h);
	next.delete(id);
	return next;
};

const release = (drafts: Draft[]) => {
	for (const d of drafts) if (d.preview) URL.revokeObjectURL(d.preview);
};

const draftOf = (
	file: File,
	extra: Partial<Draft> = {},
	key = `${file.name}-${crypto.randomUUID()}`,
): Draft => ({
	key,
	file,
	...(file.type.startsWith("image/") && !extra.refusal
		? { preview: URL.createObjectURL(file) }
		: {}),
	...extra,
});

const URL_ONLY = /^https?:\/\/\S+$/;
/** Sent messages Up recalls in an empty box (#1024). */
const HISTORY_SIZE = 10;

/** The host a hint names when a pasted link has no matching connection. */
function connectHint(url: string): string {
	const host = (() => {
		try {
			return new URL(url).hostname;
		} catch {
			return "";
		}
	})();
	if (host === "github.com") return "Connect GitHub to preview";
	if (host === "gitlab.com") return "Connect GitLab to preview";
	if (host === "bitbucket.org") return "Connect Bitbucket to preview";
	return "Connect a source to preview";
}

/**
 * The one composer (#1020, #1024): above the box what the thread is about; inside it
 * the chips (files, pastes, quotes, references, a command) and how the agent runs;
 * under it only a blocked reason or an error. The draft survives reloads (#1024).
 */
export function Composer({
	state,
	onSend,
	extras,
	footer,
	onStop,
	stopping,
	onResume,
	resuming,
	placeholder,
	choice,
	onChoice,
	locked,
	branch,
	dock,
	blockedReason,
	blockedQuiet,
	autoFocus,
	top,
	slash,
	mode,
	text: keptText,
	onText,
	initialFiles,
	onFilesChange,
	boxRef,
	accessHint,
	agentless,
	emptySend,
	sendLabel = "Send",
	ended,
	notice,
	holdSend,
	pending,
	undeliverable,
	onSaveAsNote,
	above,
	floating,
	noFiles,
	onRepeat,
	focusSignal,
	scope: givenScope,
	seed,
}: ComposerProps) {
	// Only the thread page's follow-up box (locked) reads the address; a dialog's box keeps nothing.
	const scope = givenScope ?? null;
	const threadId = scope ? scopeThreadId(scope) : null;
	const [ownText, setOwnText] = useState("");
	const text = keptText ?? ownText;
	const setText = onText ?? setOwnText;
	const [drafts, setDrafts] = useState<Draft[]>(() =>
		(initialFiles ?? []).map((f) => draftOf(f)),
	);
	const seeded = useRef(seed ?? null);
	const [quotes, setQuotes] = useState<QuoteChip[]>(() => seed?.quotes ?? []);
	const [refs, setRefs] = useState<RefChipItem[]>(() =>
		(seed?.references ?? []).map((ref) => ({
			key: crypto.randomUUID(),
			ref,
		})),
	);
	const [command, setCommand] = useState<CommandChipItem | null>(null);
	const [openPaste, setOpenPaste] = useState<string | null>(null);
	const [refusal, setRefusal] = useState<string | null>(null);
	const [hint, setHint] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
	const [caret, setCaret] = useState(0);
	const [dismissed, setDismissed] = useState<number | null>(null);
	const [active, setActive] = useState(0);
	const [history, setHistory] = usePersistedState<string[]>(
		`pl.sent.${scope ?? "none"}`,
		NO_HISTORY,
	);
	const recall = useRef<number | null>(null);
	const ref = useRef<HTMLTextAreaElement>(null);
	const picker = useRef<HTMLInputElement>(null);
	const client = useComposerClient();
	const compact = useCompactThread(client);
	const resolve = useResolveLinks(client);
	const use = useReferenceUse(client);
	const live = state === "live";
	const blocked = !!blockedReason;
	const hasText = !!text.trim();
	const kept = drafts.filter((d) => !d.refusal);
	const hasChips = kept.length > 0 || quotes.length > 0 || refs.length > 0;
	// A deferred draft stays locked while it is unchanged; editing it makes a new send.
	const draftId = JSON.stringify([
		text.trim(),
		drafts.map((d) => d.key),
		quotes.map((q) => q.key),
		refs.map((r) => r.key),
	]);
	const busy = sending || held.has(draftId) || !!pending;
	const canSend =
		!busy &&
		!blocked &&
		!holdSend &&
		(hasText || hasChips || !!command || !!emptySend);
	const { harness } = choice;
	const facts = harness ? HARNESS_REGISTRY[harness.id as HarnessId] : undefined;
	const agentLabel = harness?.label ?? "The agent";
	const agentFacts = {
		label: agentLabel,
		images:
			harness?.checked?.outcome === "answers-acp"
				? harness.checked.images
				: null,
	};

	// The menu: a trigger at the caret, searched as typed; Esc dismisses that trigger only.
	const trigger = activeTrigger(text, caret);
	const menuOpen =
		!!trigger && dismissed !== trigger.start && !blocked && !command;
	const search = useReferenceSearch(
		menuOpen && trigger
			? {
					q: trigger.query,
					trigger: trigger.trigger,
					limit: 20,
					...(threadId
						? { threadId }
						: scope
							? {
									scope,
									...(harness ? { harness: harness.id as HarnessId } : {}),
								}
							: harness
								? { harness: harness.id as HarnessId }
								: {}),
				}
			: null,
		client,
	);
	const result =
		menuOpen && trigger ? menuResult(search.data, trigger, slash) : undefined;
	const groups =
		result && trigger
			? groupHits(result.hits, trigger.trigger, trigger.query)
			: [];
	const rows = menuRows(groups);
	const activeRow = Math.min(active, Math.max(0, rows.length - 1));

	// The draft: journal and server, restored once per scope.
	const content = useMemo(
		() => ({
			text,
			quotes: quotes.map((q) => q.quote),
			references: refs.map((r) => r.ref),
		}),
		[text, quotes, refs],
	);
	const pendingFiles = useMemo(
		() =>
			drafts
				.filter((d) => !d.refusal)
				.map((d) => ({
					key: d.key,
					name: d.file.name,
					type: d.file.type,
					...(d.pasted !== undefined ? { pasted: d.pasted } : {}),
				})),
		[drafts],
	);
	const draft = useComposerDraft({
		client,
		scope,
		content,
		files: pendingFiles,
		onRestore: (c, files) => {
			// A restored draft keeps the seed the box opened with, such as an "Ask in a new thread" quote.
			const opened = seeded.current;
			seeded.current = null;
			setText(c.text);
			setQuotes([
				...c.quotes.map((quote) => ({
					key: crypto.randomUUID(),
					quote,
					cut: false,
				})),
				...(opened?.quotes ?? []),
			]);
			setRefs([
				...c.references.map((r) => ({ key: crypto.randomUUID(), ref: r })),
				...(opened?.references ?? [])
					.filter(
						(r) =>
							!c.references.some((x) => x.kind === r.kind && x.id === r.id),
					)
					.map((r) => ({ key: crypto.randomUUID(), ref: r })),
			]);
			if (!scope || !files.length) return;
			void Promise.all(
				files.map(async (f) => {
					const file =
						f.pasted !== undefined
							? new File([f.pasted], f.name, { type: f.type })
							: await keptFile(scope, f);
					return file
						? draftOf(
								file,
								f.pasted !== undefined ? { pasted: f.pasted } : {},
								f.key,
							)
						: null;
				}),
			).then((back) => {
				const found = back.filter((d): d is Draft => !!d);
				if (found.length)
					setDrafts((d) => [
						...d,
						...found.filter((x) => !d.some((y) => y.key === x.key)),
					]);
			});
		},
	});

	useEffect(() => {
		if (autoFocus) ref.current?.focus();
	}, [autoFocus]);
	useEffect(() => {
		const box = ref.current;
		if (!focusSignal || !box) return;
		box.focus();
		box.setSelectionRange(box.value.length, box.value.length);
	}, [focusSignal]);
	// A quote from the selection popover on this thread's page lands here.
	useEffect(() => {
		if (!threadId) return;
		return onQuote(threadId, (q) => {
			setQuotes((all) => [...all, q]);
			ref.current?.focus();
		});
	}, [threadId]);
	const shown = useRef(drafts);
	shown.current = drafts;
	const textNow = useRef(text);
	textNow.current = text;
	useEffect(() => {
		if (boxRef) boxRef.current = { text, files: kept.map((d) => d.file) };
	}, [boxRef, text, kept]);
	const filesChanged = useRef(onFilesChange);
	filesChanged.current = onFilesChange;
	useEffect(() => {
		filesChanged.current?.(drafts.filter((d) => !d.refusal).map((d) => d.file));
	}, [drafts]);
	useEffect(() => () => release(shown.current), []);

	const keepBytes = (d: Draft) => {
		if (!scope || d.pasted !== undefined) return;
		void keepFile(scope, d.key, d.file).then((ok) => {
			if (!ok)
				setDrafts((all) =>
					all.map((x) => (x.key === d.key ? { ...x, unsaved: true } : x)),
				);
		});
	};

	const add = async (files: File[], extra: Partial<Draft> = {}) => {
		const ready = await Promise.all(files.map(downscaleImage));
		// Counted from what the box shows now; adds are one user action at a time.
		const ok = shown.current.filter((d) => !d.refusal);
		let count = ok.length;
		let bytes = ok.reduce((n, d) => n + d.file.size, 0);
		let why: string | null = null;
		const next = ready.map((file) => {
			const no = attachRefusal(file, { count, bytes }, agentFacts);
			if (no) {
				why = no;
				return draftOf(file, { ...extra, refusal: no });
			}
			count++;
			bytes += file.size;
			const d = draftOf(file, extra);
			keepBytes(d);
			return d;
		});
		setDrafts((current) => [...current, ...next]);
		// The latest refusal also shows under the box, where the eye already is.
		setRefusal(why);
	};

	const removeDraft = (d: Draft) => {
		release([d]);
		if (scope) void dropFile(scope, d.key);
		setDrafts((all) => all.filter((x) => x.key !== d.key));
	};

	const setBox = (next: string, at: number) => {
		setText(next);
		setCaret(at);
		requestAnimationFrame(() => {
			const box = ref.current;
			if (!box) return;
			box.focus();
			box.setSelectionRange(at, at);
		});
	};

	const clear = (sentText: string, sentKeys: Set<string>) => {
		// A deferred send that lands later clears the text and chips it carried, no others.
		if (textNow.current.trim() === sentText) setText("");
		const gone = shown.current.filter((d) => sentKeys.has(d.key) || d.refusal);
		release(gone);
		if (scope) for (const d of gone) void dropFile(scope, d.key);
		setDrafts((d) => d.filter((x) => !sentKeys.has(x.key) && !x.refusal));
		setQuotes([]);
		setRefs([]);
		setCommand(null);
		setRefusal(null);
		setHint(null);
		draft.sent();
	};

	/** An app command the box runs itself; true when it took the send. */
	const runApp = (name: string, args: string): boolean => {
		const local = slash?.find((c) => c.id === name);
		if (local) {
			setText(args);
			local.run();
			return true;
		}
		if (name === "compact") {
			if (!threadId || !facts?.compactCommand) return false;
			if (live) {
				setRefusal("Once the agent pauses");
				return true;
			}
			compact.mutate(
				{
					id: threadId,
					...(facts.compactTakesFocus && args ? { instructions: args } : {}),
				},
				{
					onSuccess: () => clear(text.trim(), new Set()),
					onError: (e) => setRefusal(getErrorMessage(e)),
				},
			);
			return true;
		}
		if (name === "new") {
			openNewThread({
				quotes,
				references: [
					...refs.map((r) => r.ref),
					...(threadId
						? [{ kind: "thread" as const, id: threadId, label: "This thread" }]
						: []),
				],
				...(harness ? { harness: harness.id as HarnessId } : {}),
				...(choice.model ? { model: choice.model } : {}),
			});
			setText(args);
			setCommand(null);
			return true;
		}
		if (name === "model" || name === "effort") {
			setText(args);
			setCommand(null);
			if (locked) setHint("Kept from the first message");
			else
				document
					.querySelector<HTMLElement>('[data-testid="model-chip"]')
					?.click();
			return true;
		}
		if (name === "context") {
			setText(args);
			setCommand(null);
			openContextMeter();
			return true;
		}
		return false;
	};

	const pick = (hit: ReferenceHit) => {
		if (!trigger) return;
		const { text: rest, caret: at } = removeTrigger(text, trigger);
		setDismissed(null);
		setActive(0);
		if (hit.ref.kind === "command") {
			const name = hit.ref.id.replace(/^agent:/, "");
			const source = hit.source ?? "app";
			if (source === "app" && name !== "compact") {
				setBox(rest, at);
				runApp(name, rest);
				return;
			}
			setCommand({
				name,
				source,
				group: hit.group ?? (source === "app" ? "PrismaLens" : agentLabel),
				...(hit.inputHint ? { inputHint: hit.inputHint } : {}),
			});
			setBox(rest, at);
			return;
		}
		setRefs((all) =>
			all.some((r) => r.ref.kind === hit.ref.kind && r.ref.id === hit.ref.id)
				? all
				: [...all, { key: crypto.randomUUID(), ref: hit.ref }],
		);
		use.mutate({ kind: hit.ref.kind, id: hit.ref.id });
		setBox(rest, at);
	};

	const submit = async (now: boolean) => {
		if (!canSend) return;
		let sentText = text.trim();
		// A picked command goes first in its own turn; typed, the app's command wins (#1024).
		if (command?.source === "app") {
			if (runApp(command.name, sentText)) return;
		} else if (command) {
			sentText = `/${command.name}${sentText ? ` ${sentText}` : ""}`;
		} else {
			const typed = /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/.exec(sentText);
			if (typed && runApp(typed[1] as string, (typed[2] ?? "").trim())) return;
		}
		setSending(true);
		const sent = kept;
		const sentKeys = new Set(sent.map((d) => d.key));
		const sentId = draftId;
		try {
			const reply = await onSend(
				{
					...envelopeOf(
						sentText,
						sent.map((d) => d.file),
					),
					quotes: quotes.map((q) => q.quote),
					references: refs.map((r) => r.ref),
					...draft.sendFields(),
					...extras,
				},
				now,
			);
			const receipt = typeof reply === "string" ? { result: reply } : reply;
			const remember = () =>
				sentText &&
				setHistory((h) =>
					[sentText, ...h.filter((x) => x !== sentText)].slice(0, HISTORY_SIZE),
				);
			if (receipt.result === "sent") {
				remember();
				clear(text.trim(), sentKeys);
			} else if (receipt.result === "deferred") {
				setHeld((h) => new Set(h).add(sentId));
				void receipt.settled?.then(
					(r) => {
						setHeld(without(sentId));
						if (r === "sent") {
							remember();
							clear(text.trim(), sentKeys);
						}
					},
					(e: unknown) => {
						setHeld(without(sentId));
						setRefusal(getErrorMessage(e));
					},
				);
			}
		} catch (e) {
			setRefusal(getErrorMessage(e));
		} finally {
			setSending(false);
		}
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		const composing = e.nativeEvent.isComposing || e.keyCode === 229;
		if (menuOpen && trigger && !composing) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				if (!rows.length) return;
				e.preventDefault();
				const step = e.key === "ArrowDown" ? 1 : -1;
				setActive((activeRow + step + rows.length) % rows.length);
				return;
			}
			if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
				const hit = rows[activeRow];
				// Nothing to pick: Enter sends, Tab moves on; nothing becomes a mention unpicked.
				if (hit) {
					e.preventDefault();
					pick(hit);
					return;
				}
			}
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				setDismissed(trigger.start);
				return;
			}
		}
		const box = e.currentTarget;
		const atStart = box.selectionStart === 0 && box.selectionEnd === 0;
		if (e.key === "Backspace" && atStart && !composing) {
			const last = refs[refs.length - 1];
			if (command) {
				e.preventDefault();
				setCommand(null);
				return;
			}
			if (last) {
				e.preventDefault();
				setRefs((all) => all.slice(0, -1));
				if (last.url) setBox(`${last.url}${text}`, last.url.length);
				return;
			}
		}
		if (
			e.key === "ArrowUp" &&
			!composing &&
			history.length &&
			(!text || recall.current !== null)
		) {
			const i = recall.current === null ? 0 : recall.current + 1;
			const back = history[i];
			if (back !== undefined) {
				e.preventDefault();
				recall.current = i;
				setText(back);
				return;
			}
		}
		const key = composerKeyAction(
			{
				key: e.key,
				shiftKey: e.shiftKey,
				ctrlKey: e.ctrlKey,
				metaKey: e.metaKey,
				altKey: e.altKey,
				isComposing: composing,
			},
			live ? "live" : state === "interrupted" ? "resume" : "draft",
			live && !stopping,
		);
		if (!key) return;
		e.preventDefault();
		e.stopPropagation();
		if (key === "stop") onStop?.();
		else if (key === "blur") ref.current?.blur();
		else void submit(key === "now");
	};

	const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
		const files = Array.from(e.clipboardData.files);
		if (files.length && !noFiles) {
			e.preventDefault();
			void add(files);
			return;
		}
		const pasted = e.clipboardData.getData("text/plain");
		if (!pasted) return;
		// A long paste becomes a chip, never a refusal, at a fixed threshold (#1024).
		if (!noFiles && shouldFoldPaste(pasted)) {
			e.preventDefault();
			void add(
				[new File([pasted], "pasted-text.txt", { type: "text/plain" })],
				{ pasted },
			);
			return;
		}
		const url = pasted.trim();
		if (URL_ONLY.test(url)) void linkChip(url);
	};

	/** A pasted link a connected source knows becomes `#123 · title`; else a quiet hint. */
	const linkChip = async (url: string) => {
		try {
			const {
				results: [res],
			} = await resolve.mutateAsync({ urls: [url] });
			if (!res || !("ref" in res)) {
				setHint(connectHint(url));
				return;
			}
			const at = textNow.current.indexOf(url);
			if (at >= 0)
				setText(
					textNow.current.slice(0, at) + textNow.current.slice(at + url.length),
				);
			setRefs((all) => [
				...all,
				{
					key: crypto.randomUUID(),
					ref: res.ref,
					url,
					...(res.tone ? { tone: res.tone } : {}),
				},
			]);
		} catch {
			// Unresolved: the link stays text.
		}
	};

	const pasteAsText = (d: Draft) => {
		if (d.pasted === undefined) return;
		const box = ref.current;
		const at = box?.selectionStart ?? text.length;
		removeDraft(d);
		setOpenPaste(null);
		setBox(text.slice(0, at) + d.pasted + text.slice(at), at + d.pasted.length);
	};
	const pasteRefusal = (d: Draft) =>
		d.pasted !== undefined &&
		text.length + d.pasted.length > DRAFT_TEXT_MAX_CHARS
			? `Over ${DRAFT_TEXT_MAX_CHARS.toLocaleString("en")} characters`
			: null;

	const action =
		live && !hasText && onStop ? (
			<Hint label="Stop" keys={["Esc"]} side="top">
				<PromptInputButton
					aria-label="Stop"
					disabled={stopping}
					onClick={onStop}
					className="w-8 rounded-full bg-text-1 text-canvas hover:bg-text-2"
					data-testid="composer-stop"
				>
					<Square className="size-3 fill-current" />
				</PromptInputButton>
			</Hint>
		) : state === "interrupted" && !hasText && onResume ? (
			<Hint label="Resume" side="top">
				<PromptInputButton
					aria-label="Resume"
					disabled={resuming}
					onClick={onResume}
					className="w-8 rounded-full bg-text-1 text-canvas hover:bg-text-2"
					data-testid="composer-resume"
				>
					<Play className="size-3 fill-current" />
				</PromptInputButton>
			</Hint>
		) : (
			<>
				{onRepeat && (
					<Hint label="Repeat…" side="top">
						<PromptInputButton
							aria-label="Repeat…"
							disabled={!hasText || busy}
							onClick={() => onRepeat(text.trim())}
							className="w-8 text-text-3"
							data-testid="composer-repeat"
						>
							<Repeat className="size-3.5" />
						</PromptInputButton>
					</Hint>
				)}
				<Hint label={sendLabel} keys={["Enter"]} side="top">
					<span className="inline-flex">
						<PromptInputSubmit
							status={busy ? "submitted" : undefined}
							disabled={!canSend}
							aria-label={sendLabel}
							data-testid="composer-send"
						/>
					</span>
				</Hint>
			</>
		);

	if (ended)
		return (
			<div className="flex flex-col gap-1" data-testid="thread-composer">
				{above}
				<div
					className="flex items-center gap-3 rounded-[10px] bg-surface-2 px-3 py-2.5 text-text-2"
					data-testid="composer-no-session"
				>
					<span className="min-w-0 flex-1">
						{ended.reason ??
							"This run kept no agent session, so it can't continue. Start a new run."}
					</span>
					{ended.onRecheck && (
						<Button
							variant="secondary"
							onClick={ended.onRecheck}
							data-testid="composer-recheck"
						>
							Investigate again
						</Button>
					)}
					<Button
						variant="secondary"
						onClick={ended.onNewRun}
						data-testid="composer-new-run"
					>
						<Plus />
						New run
					</Button>
				</div>
			</div>
		);

	const hasEffort = effortLevels(harness).length > 0;
	const clipHint =
		agentFacts.images === true
			? "Attach files or a screenshot"
			: agentFacts.images === false
				? `${agentLabel} can't take images. Other files attach.`
				: "Images: not checked yet. Other files attach.";
	const chipCount =
		drafts.length + quotes.length + refs.length + (command ? 1 : 0);
	const docked = !!dock || chipCount > 0;
	// The command's hint is the ghost text; a command with no hint has no placeholder.
	const ghost = command
		? (command.inputHint ??
			(command.name === "compact" && facts?.compactTakesFocus
				? "Focus (optional)"
				: ""))
		: placeholder;
	return (
		<div className="flex flex-col gap-1" data-testid="thread-composer">
			{above}
			{(top || branch || mode) && (
				<div className="flex min-w-0 flex-wrap items-center gap-1.5">
					{top}
					{mode && (
						<span
							className="inline-flex h-7 items-center gap-1 rounded-control bg-surface-3 pr-1 pl-2 text-meta font-medium text-text-1"
							data-testid="composer-mode"
							data-mode={mode.id}
						>
							{mode.label}
							{mode.onClear && (
								<button
									type="button"
									aria-label={`Clear ${mode.label}`}
									onClick={mode.onClear}
									className="rounded-[4px] p-0.5 text-text-3 hover:bg-surface-4 hover:text-text-1"
									data-testid="composer-mode-clear"
								>
									<X className="size-3" />
								</button>
							)}
						</span>
					)}
					{branch && (
						<span
							className="inline-flex h-7 min-w-0 items-center gap-1 px-1.5 text-meta text-text-3"
							data-testid="composer-branch"
						>
							<GitBranch className="size-3.5 shrink-0" aria-hidden />
							<span className="truncate">{branch}</span>
						</span>
					)}
				</div>
			)}
			{draft.conflict && (
				<ConflictLine
					onKeepMine={draft.keepMine}
					onUseTheirs={draft.useTheirs}
				/>
			)}
			{menuOpen && trigger && (result || search.isFetching || search.error) && (
				<ComposerMenu
					trigger={trigger.trigger}
					query={trigger.query}
					result={result}
					loading={search.isFetching}
					failed={search.error ? getErrorMessage(search.error) : null}
					active={activeRow}
					onActive={setActive}
					onPick={pick}
				/>
			)}
			<div
				className={cn(
					"overflow-hidden rounded-[10px] bg-surface-2 focus-within:ring-2 focus-within:ring-accent/60",
					floating && "shadow-float",
				)}
			>
				{docked && (
					<div
						className="flex flex-col gap-2.5 bg-surface-3 px-3 pt-2.5 pb-2"
						data-testid="composer-dock"
					>
						{dock}
						{chipCount > 0 && (
							<ul
								className="flex flex-wrap gap-1.5"
								data-testid="composer-files"
							>
								{command && (
									<CommandChip
										item={command}
										onRemove={() => setCommand(null)}
									/>
								)}
								{quotes.map((q) => (
									<QuoteChipView
										key={q.key}
										item={q}
										onRemove={() =>
											setQuotes((all) => all.filter((x) => x.key !== q.key))
										}
									/>
								))}
								{refs.map((r) => (
									<RefChip
										key={r.key}
										item={r}
										onRemove={() =>
											setRefs((all) => all.filter((x) => x.key !== r.key))
										}
									/>
								))}
								{drafts.map((d) => (
									<FileChip
										key={d.key}
										item={d}
										open={openPaste === d.key}
										onToggle={() =>
											setOpenPaste((k) => (k === d.key ? null : d.key))
										}
										onRemove={() => removeDraft(d)}
										onPasteAsText={() => pasteAsText(d)}
										pasteRefusal={pasteRefusal(d)}
									/>
								))}
							</ul>
						)}
					</div>
				)}
				<PromptInput
					data-live={live ? "" : undefined}
					className="[&>[data-slot=input-group]]:bg-transparent"
					onSubmit={() => void submit(false)}
					onDragOver={(e) => e.preventDefault()}
					onDrop={(e) => {
						if (!e.dataTransfer.files.length) return;
						e.preventDefault();
						add(Array.from(e.dataTransfer.files));
					}}
				>
					<PromptInputBody>
						<PromptInputTextarea
							ref={ref}
							value={text}
							onChange={(e) => {
								recall.current = null;
								setText(e.target.value);
								setCaret(e.target.selectionStart);
							}}
							onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
							onKeyDown={onKeyDown}
							onPaste={onPaste}
							disabled={blocked}
							placeholder={ghost}
							aria-label={placeholder}
							role="combobox"
							aria-expanded={menuOpen && rows.length > 0}
							aria-controls={menuOpen ? "composer-menu" : undefined}
							aria-autocomplete="list"
							aria-activedescendant={
								menuOpen && rows.length ? optionId(activeRow) : undefined
							}
							className="min-h-6"
							data-testid="composer-input"
						/>
					</PromptInputBody>
					<PromptInputFooter className="-ml-1.5">
						{/* One row on a phone: chips keep full labels and scroll sideways, Send stays put (#1020). */}
						<PromptInputTools
							className="min-w-0 flex-1 gap-0.5 max-sm:overflow-x-auto max-sm:[scrollbar-width:none] max-sm:[&>*]:shrink-0 sm:flex-wrap sm:gap-y-1"
							data-testid="composer-chips"
							data-scroll-x
						>
							{!noFiles && (
								<Hint label={clipHint} side="top">
									<PromptInputButton
										aria-label="Attach a file"
										disabled={blocked}
										onClick={() => picker.current?.click()}
										className="w-8 text-text-3"
										data-testid="composer-attach"
									>
										<Paperclip className="size-3.5" />
									</PromptInputButton>
								</Hint>
							)}
							<input
								ref={picker}
								type="file"
								multiple
								hidden
								onChange={(e) => {
									if (e.target.files) void add(Array.from(e.target.files));
									e.target.value = "";
								}}
								data-testid="composer-file-input"
							/>
							{!agentless && (
								<ModelChip
									harness={harness}
									model={choice.model}
									disabled={locked || blocked}
									onPick={(h, m) =>
										onChoice({ harnessId: h.id as HarnessId, model: m })
									}
								/>
							)}
							{!agentless && hasEffort && (
								<EffortChip
									harness={harness}
									model={choice.model}
									effort={choice.effort}
									disabled={locked || blocked}
									onEffort={(effort) => onChoice({ effort })}
									onModel={(model) => onChoice({ model })}
								/>
							)}
							{!agentless && (
								<AccessChip
									harness={harness}
									level={choice.accessLevel}
									onLevel={(accessLevel) => onChoice({ accessLevel })}
									lockedHint={
										accessHint ??
										(locked ? "Kept from the first message" : undefined)
									}
									disabled={blocked}
								/>
							)}
						</PromptInputTools>
						<div className="ml-auto flex shrink-0 items-center gap-0.5">
							{action}
						</div>
					</PromptInputFooter>
				</PromptInput>
			</div>
			{((blocked && !blockedQuiet) || refusal || notice) && (
				<p
					className={cn(
						"px-3 text-meta",
						refusal ? "text-danger" : "text-text-2",
					)}
					data-testid={refusal ? "composer-refusal" : "composer-blocked"}
				>
					{refusal ?? (blocked && !blockedQuiet ? blockedReason : notice)}
				</p>
			)}
			{(hint || draft.unsaved) && (
				<p
					className="flex items-center gap-1 px-3 text-meta text-text-3"
					data-testid="composer-hint"
				>
					{hint ?? "Not saved yet"}
					{hint?.startsWith("Connect") && (
						<Button variant="text" size="sm" asChild>
							<Link to="/settings" search={{ tab: "sources" }}>
								Settings
							</Link>
						</Button>
					)}
				</p>
			)}
			{footer}
			{undeliverable && (
				<div
					className="flex flex-wrap items-center gap-2 px-3 text-meta text-danger"
					data-testid="composer-undeliverable"
				>
					The run ended before your message reached it.
					{onSaveAsNote && (
						<Button
							variant="text"
							size="sm"
							onClick={() => onSaveAsNote(undeliverable)}
						>
							Save as note
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
