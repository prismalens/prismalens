// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	ACCESS_LEVELS,
	type AccessLevel,
	HARNESS_REGISTRY,
	type HarnessId,
} from "@prismalens/config/harness";
import {
	ACCESS_LEVEL_LABEL,
	type ChipAttrs,
	type ComposerDoc,
	type ComposerInline,
	type ComposerScope,
	DRAFT_TEXT_MAX_CHARS,
	docParts,
	docText,
	emptyDoc,
	type HarnessStatus,
	isEmptyDoc,
	type ReferenceHit,
	sameDoc,
	scopeThreadId,
	shouldFoldPaste,
	textDoc,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
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
	type CSSProperties,
	type MutableRefObject,
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	EffortChip,
	ModeChip,
	ModelChip,
} from "@/components/agent/AgentPicker";
import {
	agentModes,
	chosenMode,
	levelOfMode,
} from "@/components/agent/agent-modes";
import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTools,
} from "@/components/ai/prompt-input";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import {
	readStored,
	usePersistedState,
	writeStored,
} from "@/hooks/use-persisted-state";
import { useCompactThread } from "@/lib/api/hooks/use-investigations-orpc";
import {
	useComposerClient,
	useReferenceSearch,
	useReferenceUse,
	useResolveLinks,
} from "@/lib/api/hooks/use-references-orpc";
import {
	attachRefusal,
	downscaleImage,
	uploadThreadAttachment,
} from "@/lib/attachments";
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
import { type ContextChoice, ContextControl } from "./composer/ContextControl";
import { ConflictLine } from "./composer/chips";
import { menuResult } from "./composer/commands";
import {
	draftFileBytes,
	dropFile,
	keepFile,
	keepSentFiles,
	keptFile,
	type PendingFile,
	sentFileBytes,
} from "./composer/draft-store";
import {
	CHIP_OPEN_EVENT,
	ChipContext,
	type ChipContextValue,
	type ChipFile,
	ChipView,
} from "./composer/editor/ChipView";
import {
	chipDeleteKey,
	chipNode,
	type DocTrigger,
	findText,
	insertChips,
	lineEdge,
	patchFileChip,
	pickInto,
	replaceChip,
	selectedChip,
	triggerAt,
} from "./composer/editor/commands";
import { chipAttrs, composerExtensions } from "./composer/editor/extensions";
import {
	type NewThreadSeed,
	onQuote,
	onReference,
	openNewThread,
} from "./composer/quote";
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
	/** The agent's own mode when no level maps to it; null clears it (sheet §5). */
	agentMode?: string | null;
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
	/** Tokens the thread carries: the footer's Keep or Compact control (sheet §10). */
	context?: ContextChoice | null;
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
	autoFocus?: boolean;
	/** A row above the box: a new thread's subject and Incident toggle. */
	top?: ReactNode;
	/** Quiet controls after Attach, such as a new thread's subject picker. */
	tools?: ReactNode;
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
	/** Offer only modes a level maps to: the host stores a level alone (a schedule). */
	levelModesOnly?: boolean;
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

const NO_HISTORY: StoredSent[] = [];

/** A sent message as Up recalls it: a document, or the plain text an older build kept. */
type StoredSent = ComposerDoc | string;
const sentDoc = (s: StoredSent): ComposerDoc =>
	typeof s === "string" ? textDoc(s) : s;

/** This tab's copies of recently sent files; IndexedDB keeps them past a close (#1101). */
const sentFiles = new Map<string, File>();
const SENT_FILES_KEPT = 30;
function rememberFile(key: string, file: File) {
	sentFiles.set(key, file);
	while (sentFiles.size > SENT_FILES_KEPT) {
		const oldest = sentFiles.keys().next().value;
		if (oldest === undefined) break;
		sentFiles.delete(oldest);
	}
}
const sentFile = (key: string) => sentFiles.get(key) ?? null;

const without = (id: string) => (h: ReadonlySet<string>) => {
	const next = new Set(h);
	next.delete(id);
	return next;
};

const release = (list: Iterable<ChipFile>) => {
	for (const f of Array.from(list))
		if (f.preview) URL.revokeObjectURL(f.preview);
};

const chipFile = (file: File): ChipFile => ({
	file,
	...(file.type.startsWith("image/")
		? { preview: URL.createObjectURL(file) }
		: {}),
});

const fileAttrs = (key: string, file: File, pasted?: string) => ({
	chip: "file" as const,
	key,
	name: pasted !== undefined ? "pasted-text.txt" : file.name,
	type: file.type,
	size: file.size,
	...(pasted !== undefined ? { pasted } : {}),
});

const docHasFile = (doc: ComposerDoc, key: string) =>
	docParts(doc).files.some((f) => f.key === key);

/** The editor's document in the contract's shape: text, line breaks and chips. */
function readDoc(node: PMNode): ComposerDoc {
	const content: ComposerDoc["content"] = [];
	node.forEach((p) => {
		const inline: ComposerInline[] = [];
		p.forEach((n) => {
			if (n.isText && n.text) inline.push({ type: "text", text: n.text });
			else if (n.type.name === "hardBreak") inline.push({ type: "hardBreak" });
			else if (n.type.name === "chip") {
				const attrs = chipAttrs(n.attrs);
				if (attrs) inline.push({ type: "chip", attrs });
			}
		});
		content.push({
			type: "paragraph",
			...(inline.length ? { content: inline } : {}),
		});
	});
	return content.length ? { type: "doc", content } : emptyDoc();
}

const seedChips = (seed: NewThreadSeed | null | undefined): ChipAttrs[] => [
	...(seed?.quotes ?? []).map((q) => ({
		chip: "quote" as const,
		quote: q.quote,
		cut: q.cut,
	})),
	...(seed?.references ?? []).map((ref) => ({ chip: "ref" as const, ref })),
];

/** What a fresh box shows: the seed's chips, then the page's kept text. */
function startDoc(
	seed: NewThreadSeed | null | undefined,
	text: string | undefined,
): ComposerDoc {
	return withSeed(textDoc(text ?? ""), seed ?? null);
}

/** A restored draft keeps the chips the box was opened with that it lacks. */
function withSeed(doc: ComposerDoc, seed: NewThreadSeed | null): ComposerDoc {
	const have = docParts(doc);
	const chips = seedChips(seed).filter((c) =>
		c.chip === "ref"
			? !have.references.some((r) => r.kind === c.ref.kind && r.id === c.ref.id)
			: c.chip === "quote"
				? !have.quotes.some((q) => q.text === c.quote.text)
				: true,
	);
	if (!chips.length) return doc;
	const [first, ...rest] = doc.content;
	const lead: ComposerInline[] = chips.flatMap((attrs) => [
		{ type: "chip" as const, attrs },
		{ type: "text" as const, text: " " },
	]);
	return {
		type: "doc",
		content: [
			{ type: "paragraph", content: [...lead, ...(first?.content ?? [])] },
			...rest,
		],
	};
}

/**
 * Shift+Tab cycles permission in the box instead of moving focus back, so the way out
 * is said wherever the key is (#1101 category 6 item 5; WCAG 2.1.2).
 */
export const FOCUS_BACK = "Esc, then Shift+Tab to move focus back.";

/** Why a follow-up's agent, model, effort and permission cannot change. */
const KEPT = "Kept from the first message";

/** A locked footer choice says why on hover and focus (#1101 category 6 item 4). */
function LockedWhy({
	why,
	children,
}: {
	why: string | null;
	children: ReactNode;
}) {
	if (!why) return <>{children}</>;
	return (
		<Hint label={why} side="top">
			<span className="inline-flex" data-testid="composer-locked">
				{children}
			</span>
		</Hint>
	);
}

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
 * The one composer (#1020, #1024, #1101): above the box what the thread is about;
 * inside it an editor whose chips (files, pastes, quotes, references, a command) sit
 * in the text where they were added, with undo; under it the agent's run choices.
 * The draft is a versioned document that survives reloads and other devices.
 */
export function Composer({
	state,
	onSend,
	extras,
	footer,
	context,
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
	levelModesOnly,
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
	tools,
	onRepeat,
	focusSignal,
	scope: givenScope,
	seed,
}: ComposerProps) {
	// Only the thread page's follow-up box (locked) reads the address; a dialog's box keeps nothing.
	const scope = givenScope ?? null;
	const threadId = scope ? scopeThreadId(scope) : null;
	const [files, setFiles] = useState<ReadonlyMap<string, ChipFile>>(
		() => new Map(),
	);
	const [doc, setDoc] = useState<ComposerDoc>(() => startDoc(seed, keptText));
	const seeded = useRef(seed ?? null);
	const [refusal, setRefusal] = useState<string | null>(null);
	const [hint, setHint] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	// Compact is a choice for the next send only; a new thread starts on Keep.
	const [compactNext, setCompactNext] = useState(false);
	const [compactFor, setCompactFor] = useState(scope);
	if (compactFor !== scope) {
		setCompactFor(scope);
		setCompactNext(false);
	}
	const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
	const [trigger, setTrigger] = useState<DocTrigger | null>(null);
	const [dismissed, setDismissed] = useState<number | null>(null);
	const [active, setActive] = useState(0);
	const historyKey = `pl.sent.${scope ?? "none"}`;
	const [stored, setHistory] = usePersistedState<StoredSent[]>(
		historyKey,
		NO_HISTORY,
	);
	const history = useMemo(() => stored.map(sentDoc), [stored]);
	/** Up and Down through sent messages: where we are, and the draft to come back to. */
	const recall = useRef<{ at: number; draft: ComposerDoc } | null>(null);
	const picker = useRef<HTMLInputElement>(null);
	const root = useRef<HTMLDivElement>(null);
	const keysId = useId();
	const rawPaste = useRef(false);
	const client = useComposerClient();
	const compact = useCompactThread(client);
	const resolve = useResolveLinks(client);
	const use = useReferenceUse(client);
	const live = state === "live";
	const blocked = !!blockedReason;
	const parts = useMemo(() => docParts(doc), [doc]);
	const command = parts.command;
	const hasText = !!parts.text;
	const keptFiles = parts.files.flatMap((f) => {
		const got = !f.refusal && files.get(f.key);
		return got ? [{ key: f.key, file: got.file }] : [];
	});
	const hasChips =
		keptFiles.length > 0 ||
		parts.quotes.length > 0 ||
		parts.references.length > 0;
	// A deferred draft stays locked while it is unchanged; editing it makes a new send.
	const draftId = JSON.stringify(doc);
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

	// The menu opens upward, so it gets the room between the box and the window's top.
	const menuAnchor = useRef<HTMLDivElement>(null);
	const [menuRoom, setMenuRoom] = useState(288);
	useLayoutEffect(() => {
		if (!trigger) return;
		const top = menuAnchor.current?.getBoundingClientRect().top ?? 300;
		setMenuRoom(Math.max(120, Math.min(288, Math.floor(top - 16))));
	}, [trigger]);
	// Esc dismisses one trigger; once it is gone, a new one at the same spot opens again (#1101 6.1).
	if (dismissed !== null && trigger?.from !== dismissed) setDismissed(null);
	// The menu: a trigger at the caret, searched as typed; Esc dismisses that trigger only.
	const menuOpen =
		!!trigger &&
		dismissed !== trigger.from &&
		!blocked &&
		!(trigger.trigger === "/" && command);
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

	const placeholderNow = useRef(placeholder);
	placeholderNow.current = placeholder;
	const keys = useRef<
		(view: EditorView, e: globalThis.KeyboardEvent) => boolean
	>(() => false);
	const pasted = useRef<
		(view: EditorView, e: globalThis.ClipboardEvent) => boolean
	>(() => false);
	const dropped = useRef<
		(view: EditorView, e: DragEvent, moved: boolean) => boolean
	>(() => false);
	const editor = useEditor({
		extensions: composerExtensions({
			chipView: ReactNodeViewRenderer(ChipView, { as: "span" }),
			placeholder: () => placeholderNow.current,
		}),
		content: doc,
		immediatelyRender: false,
		shouldRerenderOnTransaction: false,
		editorProps: {
			attributes: {
				class:
					"composer-editor max-h-40 min-h-11 overflow-y-auto py-0.5 text-body leading-5 text-text-1",
			},
			handleKeyDown: (view, e) => keys.current(view, e),
			handlePaste: (view, e) => pasted.current(view, e),
			handleDrop: (view, e, _slice, moved) => dropped.current(view, e, moved),
			handleDOMEvents: {
				// The menu waits out an IME composition, then reads the committed text.
				compositionend: (view) => {
					setTimeout(() => setTrigger(triggerAt(view.state)), 0);
					return false;
				},
			},
		},
		onUpdate: ({ editor: ed }) => {
			const next = readDoc(ed.state.doc);
			setDoc(next);
			setTrigger(ed.view.composing ? null : triggerAt(ed.state));
		},
		onSelectionUpdate: ({ editor: ed }) =>
			setTrigger(ed.view.composing ? null : triggerAt(ed.state)),
	});
	const view = () => editor?.view ?? null;

	/** Replaces the whole document, outside the undo history (a restore, a recall, a clear). */
	const setContent = (next: ComposerDoc, focusEnd = false) => {
		if (!editor) {
			setDoc(next);
			return;
		}
		editor
			.chain()
			.command(({ tr }) => {
				tr.setMeta("addToHistory", false);
				return true;
			})
			.setContent(next)
			.run();
		if (focusEnd) editor.commands.focus("end");
	};

	// The page's own text (a kept draft, a handoff): an outside change replaces the box.
	const emitted = useRef(parts.text);
	// biome-ignore lint/correctness/useExhaustiveDependencies: only an outside change of the text.
	useEffect(() => {
		if (keptText === undefined || keptText === emitted.current) return;
		emitted.current = keptText;
		setContent(textDoc(keptText));
	}, [keptText]);
	useEffect(() => {
		if (!onText || parts.text === emitted.current) return;
		emitted.current = parts.text;
		onText(parts.text);
	}, [parts.text, onText]);

	// The draft: journal and server, restored once per scope.
	const [draftKey, setDraftKey] = useState<string | null>(null);
	const draftKeyNow = useRef(draftKey);
	draftKeyNow.current = draftKey;
	const content = useMemo(() => ({ doc, draftKey }), [doc, draftKey]);
	const pendingFiles = useMemo(
		() =>
			parts.files
				.filter((f) => !f.refusal)
				.map((f) => ({
					key: f.key,
					name: f.name,
					type: f.type,
					...(f.id ? { id: f.id } : {}),
					...(f.pasted ? { pasted: f.pasted } : {}),
				})),
		[parts.files],
	);
	const loadFiles = (list: PendingFile[]) => {
		if (!scope || !list.length) return;
		void Promise.all(
			list.map(async (f) => {
				// This browser's copy first, then the draft's upload on the server (#1101).
				const file =
					f.pasted !== undefined
						? new File([f.pasted], f.name, { type: f.type })
						: ((await keptFile(scope, f)) ?? (await draftFileBytes(scope, f)));
				return file ? ([f.key, chipFile(file)] as const) : null;
			}),
		).then((back) => {
			const found = back.filter((x): x is [string, ChipFile] => !!x);
			if (found.length)
				setFiles((m) => {
					const next = new Map(m);
					for (const [k, v] of found) if (!next.has(k)) next.set(k, v);
					return next;
				});
		});
	};
	const draft = useComposerDraft({
		client,
		scope,
		content,
		files: pendingFiles,
		onRestore: (c, journalFiles) => {
			// A restored draft keeps the seed the box opened with, such as an "Ask in a new thread" quote.
			const opened = seeded.current;
			seeded.current = null;
			setContent(withSeed(c.doc, opened));
			setDraftKey(c.draftKey ?? null);
			const inDoc = docParts(c.doc).files.map((f) => ({
				key: f.key,
				name: f.name,
				type: f.type,
				...(f.id ? { id: f.id } : {}),
				...(f.pasted ? { pasted: f.pasted } : {}),
			}));
			loadFiles([
				...inDoc,
				...journalFiles.filter((j) => !inDoc.some((d) => d.key === j.key)),
			]);
		},
	});

	useEffect(() => {
		if (autoFocus) editor?.commands.focus("end");
	}, [autoFocus, editor]);
	useEffect(() => {
		if (focusSignal) editor?.commands.focus("end");
	}, [focusSignal, editor]);
	useEffect(() => {
		editor?.setEditable(!blocked);
	}, [editor, blocked]);
	// A quote from the selection popover on this thread's page lands at the end of the text.
	useEffect(() => {
		if (!threadId || !editor) return;
		return onQuote(threadId, (q) => {
			insertChips(
				editor.view,
				[{ chip: "quote", quote: q.quote, cut: q.cut }],
				editor.state.doc.content.size - 1,
			);
			editor.commands.focus("end");
		});
	}, [threadId, editor]);
	// A pane's "Attach to message" lands here as a reference chip (#1101 category 16).
	useEffect(() => {
		if (!threadId || !editor) return;
		return onReference(threadId, (r) => {
			const have = docParts(readDoc(editor.state.doc)).references;
			if (have.some((x) => x.kind === r.kind && x.id === r.id)) return;
			insertChips(
				editor.view,
				[{ chip: "ref", ref: r }],
				editor.state.doc.content.size - 1,
			);
			editor.commands.focus("end");
		});
	}, [threadId, editor]);
	// Initial files a page hands in (a prefilled handoff) become chips once.
	const initial = useRef(initialFiles);
	// biome-ignore lint/correctness/useExhaustiveDependencies: once, when the editor exists.
	useEffect(() => {
		const list = initial.current;
		if (!editor) return;
		initial.current = undefined;
		if (list?.length) void add(list);
	}, [editor]);
	const filesNow = useRef(files);
	filesNow.current = files;
	const docNow = useRef(doc);
	docNow.current = doc;
	useEffect(() => {
		if (boxRef)
			boxRef.current = {
				text: parts.text,
				files: keptFiles.map((f) => f.file),
			};
	}, [boxRef, parts.text, keptFiles]);
	const filesChanged = useRef(onFilesChange);
	filesChanged.current = onFilesChange;
	const fileList = keptFiles.map((f) => f.key).join("|");
	// biome-ignore lint/correctness/useExhaustiveDependencies: the key list is the change signal.
	useEffect(() => {
		filesChanged.current?.(keptFiles.map((f) => f.file));
	}, [fileList]);
	useEffect(() => () => release(filesNow.current.values()), []);
	// ARIA for the combobox the editor is; the element is ProseMirror's, so set it here.
	useEffect(() => {
		const dom = editor?.view.dom;
		if (!dom) return;
		const attrs: Record<string, string | null> = {
			role: "combobox",
			"aria-label": placeholder,
			"aria-autocomplete": "list",
			"aria-expanded": String(menuOpen && rows.length > 0),
			"aria-controls": menuOpen ? "composer-menu" : null,
			"aria-activedescendant":
				menuOpen && rows.length ? optionId(activeRow) : null,
			"aria-disabled": blocked ? "true" : null,
			"aria-describedby": agentless ? null : keysId,
			"data-testid": "composer-input",
		};
		for (const [k, v] of Object.entries(attrs))
			if (v === null) dom.removeAttribute(k);
			else dom.setAttribute(k, v);
	});

	/** The draft's copy on the server, under its draft key (#1101). */
	const upload = (key: string, file: File) => {
		if (!scope) return;
		const dk = draftKeyNow.current ?? crypto.randomUUID();
		if (!draftKeyNow.current) {
			draftKeyNow.current = dk;
			setDraftKey(dk);
		}
		void uploadThreadAttachment({ draftKey: dk }, file).then(
			(att) => {
				const cur = view();
				if (cur) patchFileChip(cur, key, { id: att.id });
			},
			() => {
				// Offline or refused: this browser's copy still holds it.
			},
		);
	};

	const keepBytes = (key: string, file: File) => {
		if (!scope) return;
		void keepFile(scope, key, file).then((ok) => {
			if (!ok)
				setFiles((m) => {
					const at = m.get(key);
					return at ? new Map(m).set(key, { ...at, unsaved: true }) : m;
				});
		});
	};

	/**
	 * Files become chips at the caret (or a drop point) at once, so a pasted image shows
	 * its thumbnail; the downscale and the size checks follow and put a refusal on the chip.
	 */
	const add = async (list: File[], at?: number, pastedText?: string) => {
		const v = view();
		if (!v || !list.length) return;
		const keyed = list.map((file) => ({ key: crypto.randomUUID(), file }));
		setFiles((m) => {
			const next = new Map(m);
			for (const { key, file } of keyed) next.set(key, chipFile(file));
			return next;
		});
		insertChips(
			v,
			keyed.map(({ key, file }) => ({
				chip: "file" as const,
				key,
				name: pastedText !== undefined ? "pasted-text.txt" : file.name,
				type: file.type,
				size: file.size,
				...(pastedText !== undefined ? { pasted: pastedText } : {}),
			})),
			at,
		);
		const ready = await Promise.all(keyed.map((k) => downscaleImage(k.file)));
		// Counted from the chips the box holds now; adds are one user action at a time.
		const others = docParts(docNow.current).files.filter(
			(f) => !f.refusal && !keyed.some((k) => k.key === f.key),
		);
		let count = others.length;
		let bytes = others.reduce((n, f) => n + f.size, 0);
		let why: string | null = null;
		keyed.forEach(({ key }, i) => {
			const file = ready[i] as File;
			const no = attachRefusal(file, { count, bytes }, agentFacts);
			const cur = view();
			if (no) {
				why = no;
				if (cur)
					replaceChip(
						cur,
						(a) => a.chip === "file" && a.key === key,
						(s) =>
							chipNode(s, { ...fileAttrs(key, file, pastedText), refusal: no }),
						false,
					);
				return;
			}
			count++;
			bytes += file.size;
			if (file !== keyed[i]?.file) {
				setFiles((m) => {
					const had = m.get(key);
					return new Map(m).set(key, {
						...chipFile(file),
						...(had?.preview ? { preview: had.preview } : {}),
					});
				});
				if (cur)
					replaceChip(
						cur,
						(a) => a.chip === "file" && a.key === key,
						(s) => chipNode(s, fileAttrs(key, file, pastedText)),
						false,
					);
			}
			if (pastedText === undefined) {
				keepBytes(key, file);
				upload(key, file);
			}
		});
		// The latest refusal also shows under the box, where the eye already is.
		setRefusal(why);
	};

	const clear = (sent: ComposerDoc, sentKeys: Set<string>) => {
		// A deferred send that lands after more editing clears only the files it carried.
		if (sameDoc(docNow.current, sent)) setContent(emptyDoc());
		else
			for (const key of Array.from(sentKeys)) {
				const v = view();
				if (v)
					replaceChip(
						v,
						(a) => a.chip === "file" && a.key === key,
						() => null,
						false,
					);
			}
		if (scope)
			for (const key of Array.from(filesNow.current.keys()))
				if (sentKeys.has(key) || !docHasFile(docNow.current, key))
					void dropFile(scope, key);
		setRefusal(null);
		setHint(null);
		// The server deleted the draft's uploads with the send; the next file starts a new key.
		draftKeyNow.current = null;
		setDraftKey(null);
		draft.sent();
	};

	/** An app command the box runs itself; true when it took the send. `args` null keeps the text. */
	const runApp = (name: string, args: string | null): boolean => {
		const setArgs = () => args !== null && setContent(textDoc(args), true);
		const local = slash?.find((c) => c.id === name);
		if (local) {
			setArgs();
			local.run();
			return true;
		}
		if (name === "compact") {
			if (!threadId || !facts?.compactCommand) return false;
			if (live) {
				setRefusal("Once the agent pauses");
				return true;
			}
			const sent = docNow.current;
			compact.mutate(
				{
					id: threadId,
					...(facts.compactTakesFocus && args ? { instructions: args } : {}),
				},
				{
					onSuccess: () => clear(sent, new Set()),
					onError: (e) => setRefusal(getErrorMessage(e)),
				},
			);
			return true;
		}
		if (name === "new") {
			openNewThread({
				quotes: parts.quotes.map((quote) => ({
					key: crypto.randomUUID(),
					quote,
					cut: false,
				})),
				references: [
					...parts.references,
					...(threadId
						? [{ kind: "thread" as const, id: threadId, label: "This thread" }]
						: []),
				],
				...(harness ? { harness: harness.id as HarnessId } : {}),
				...(choice.model ? { model: choice.model } : {}),
			});
			setContent(textDoc(args ?? ""), true);
			return true;
		}
		if (name === "model" || name === "effort") {
			setContent(textDoc(args ?? ""), true);
			openModelList();
			return true;
		}
		if (name === "context") {
			setContent(textDoc(args ?? ""), true);
			openContextMeter();
			return true;
		}
		return false;
	};

	const openModelList = () => {
		if (locked) setHint(KEPT);
		else
			root.current
				?.querySelector<HTMLElement>('[data-testid="agent-picker"]')
				?.click();
	};

	/** Shift+Tab: the next permission level, said in one line (#1101 category 6 item 5). */
	const cyclePermission = () => {
		const why = accessHint ?? (locked ? KEPT : null);
		if (why) {
			setHint(why);
			return;
		}
		// The agent's own modes when it lists them, else the four levels (sheet §5).
		const modes = agentModes(harness);
		if (modes) {
			const now = chosenMode(harness, choice.accessLevel, choice.agentMode);
			const at = modes.findIndex((m) => m.id === now);
			const next = modes[(at + 1) % modes.length];
			if (!next) return;
			const mapped = levelOfMode(harness, next.id, choice.accessLevel);
			onChoice(
				mapped
					? { accessLevel: mapped, agentMode: null }
					: { agentMode: next.id },
			);
			setHint(next.name);
			return;
		}
		const next =
			ACCESS_LEVELS[
				(ACCESS_LEVELS.indexOf(choice.accessLevel) + 1) % ACCESS_LEVELS.length
			] ?? "supervised";
		onChoice({ accessLevel: next, agentMode: null });
		setHint(ACCESS_LEVEL_LABEL[next]);
	};

	const pick = (hit: ReferenceHit) => {
		const v = view();
		if (!trigger || !v) return;
		setDismissed(null);
		setActive(0);
		if (hit.ref.kind === "command") {
			const name = hit.ref.id.replace(/^agent:/, "");
			const source = hit.source ?? "app";
			if (source === "app" && name !== "compact") {
				pickInto(v, trigger, null);
				runApp(name, null);
				return;
			}
			const inputHint =
				hit.inputHint ??
				(name === "compact" && facts?.compactTakesFocus
					? "Focus (optional)"
					: null);
			pickInto(v, trigger, {
				chip: "command",
				name,
				source,
				group: hit.group ?? (source === "app" ? "PrismaLens" : agentLabel),
				...(inputHint ? { inputHint } : {}),
			});
			return;
		}
		use.mutate({ kind: hit.ref.kind, id: hit.ref.id });
		pickInto(v, trigger, { chip: "ref", ref: hit.ref });
	};

	const submit = async (now: boolean) => {
		if (!canSend) return;
		const sentDocNow = docNow.current;
		let sentText = parts.text;
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
		const sent = keptFiles;
		const sentKeys = new Set(sent.map((f) => f.key));
		const sentId = draftId;
		// Recorded as it goes out, and taken back if it does not: a send that opens a new
		// thread can unload this page before its promise settles.
		const before = readStored<StoredSent[]>(historyKey, NO_HISTORY);
		const record = (list: StoredSent[]) => {
			writeStored(historyKey, list);
			setHistory(list);
		};
		const recorded = !(isEmptyDoc(sentDocNow) && !sent.length);
		if (recorded) {
			for (const f of sent) rememberFile(f.key, f.file);
			const kept = [sentDocNow, ...before].slice(0, HISTORY_SIZE);
			void keepSentFiles(
				sent,
				new Set(
					kept.flatMap((d) => docParts(sentDoc(d)).files.map((f) => f.key)),
				),
			);
			record(
				[
					sentDocNow,
					...before.filter((x) => !sameDoc(sentDoc(x), sentDocNow)),
				].slice(0, HISTORY_SIZE),
			);
		}
		const takeBack = () => recorded && record(before);
		try {
			const fields = await draft.sendFields();
			const reply = await onSend(
				{
					...envelopeOf(
						sentText,
						sent.map((f) => f.file),
					),
					quotes: parts.quotes,
					references: parts.references,
					...fields,
					...extras,
					...(compactNext && context?.canCompact ? { compact: true } : {}),
				},
				now,
			);
			const receipt = typeof reply === "string" ? { result: reply } : reply;
			if (receipt.result === "sent") {
				clear(sentDocNow, sentKeys);
				setCompactNext(false);
			} else if (receipt.result === "deferred") {
				setHeld((h) => new Set(h).add(sentId));
				void receipt.settled?.then(
					(r) => {
						setHeld(without(sentId));
						if (r === "sent") clear(sentDocNow, sentKeys);
						else takeBack();
					},
					(e: unknown) => {
						setHeld(without(sentId));
						takeBack();
						setRefusal(getErrorMessage(e));
					},
				);
			} else takeBack();
		} catch (e) {
			takeBack();
			setRefusal(getErrorMessage(e));
		} finally {
			draft.release();
			setSending(false);
		}
	};

	/** Up on an empty box, then Up and Down through sent messages with their chips (#1101 row 13). */
	const recallStep = (step: 1 | -1): boolean => {
		const cur = recall.current;
		if (step === 1) {
			if (!cur && !isEmptyDoc(docNow.current)) return false;
			const at = cur ? cur.at + 1 : 0;
			const back = history[at];
			if (!back) return !!cur;
			recall.current = { at, draft: cur?.draft ?? docNow.current };
			showRecalled(back);
			return true;
		}
		if (!cur) return false;
		if (cur.at === 0) {
			recall.current = null;
			setContent(cur.draft, true);
			return true;
		}
		const back = history[cur.at - 1];
		if (!back) return false;
		recall.current = { ...cur, at: cur.at - 1 };
		showRecalled(back);
		return true;
	};
	const showRecalled = (back: ComposerDoc) => {
		setContent(back, true);
		void Promise.all(
			docParts(back).files.map(async (f) => {
				const file =
					sentFile(f.key) ?? (await sentFileBytes(f.key, f.name, f.type));
				return file ? ([f.key, chipFile(file)] as const) : null;
			}),
		).then((list) => {
			const again = list.filter((x): x is [string, ChipFile] => !!x);
			if (again.length)
				setFiles((m) => {
					const next = new Map(m);
					for (const [k, v] of again) if (!next.has(k)) next.set(k, v);
					return next;
				});
		});
	};

	keys.current = (v, e) => {
		const composing = v.composing || e.isComposing || e.keyCode === 229;
		if (composing) return false;
		if (menuOpen && trigger) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				if (!rows.length) return false;
				const step = e.key === "ArrowDown" ? 1 : -1;
				setActive((activeRow + step + rows.length) % rows.length);
				return true;
			}
			if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
				const hit = rows[activeRow];
				// Nothing to pick: Enter sends, Tab moves on; nothing becomes a mention unpicked.
				if (hit) {
					pick(hit);
					return true;
				}
			}
			if (e.key === "Escape") {
				e.stopPropagation();
				setDismissed(trigger.from);
				return true;
			}
		}
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.shiftKey && e.code === "KeyV") {
			rawPaste.current = true;
			return false;
		}
		if (e.altKey && !mod && e.code === "KeyP" && !agentless) {
			openModelList();
			return true;
		}
		if (e.key === "Tab" && e.shiftKey && !mod && !e.altKey && !agentless) {
			cyclePermission();
			return true;
		}
		if ((e.key === "Backspace" || e.key === "Delete") && !mod && !e.altKey)
			if (chipDeleteKey(v, e.key)) return true;
		const chosen = selectedChip(v.state);
		if (chosen && e.key === "Enter" && !e.shiftKey && !mod) {
			const dom = v.nodeDOM(chosen.pos) as HTMLElement | null;
			const inner = dom?.querySelector("[data-node-view-wrapper]") ?? dom;
			inner?.dispatchEvent(new Event(CHIP_OPEN_EVENT));
			return true;
		}
		if ((e.key === "Home" || e.key === "End") && !mod && !e.altKey)
			return lineEdge(v, e.key === "Home" ? "start" : "end", e.shiftKey);
		if (!mod && !e.shiftKey && !e.altKey) {
			if (e.key === "ArrowUp" && recallStep(1)) return true;
			if (e.key === "ArrowDown" && recallStep(-1)) return true;
		}
		if (e.key !== "ArrowUp" && e.key !== "ArrowDown") recall.current = null;
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
		if (!key) return false;
		e.stopPropagation();
		if (key === "stop") onStop?.();
		else if (key === "blur") v.dom.blur();
		else void submit(key === "now");
		return true;
	};

	pasted.current = (_v, e) => {
		const data = e.clipboardData;
		if (!data) return false;
		// Ctrl/Cmd+Shift+V: the editor's own plain-text paste, no folding or chips.
		if (rawPaste.current) {
			rawPaste.current = false;
			return false;
		}
		const list = Array.from(data.files);
		if (list.length && !noFiles) {
			void add(list);
			return true;
		}
		const text = data.getData("text/plain");
		// Chips copied from a composer paste back as chips: the editor parses its own HTML.
		if (!text || data.getData("text/html").includes("data-chip")) return false;
		// A long paste becomes a chip, never a refusal, at a fixed threshold (#1024).
		if (!noFiles && shouldFoldPaste(text)) {
			void add(
				[new File([text], "pasted-text.txt", { type: "text/plain" })],
				undefined,
				text,
			);
			return true;
		}
		const url = text.trim();
		if (URL_ONLY.test(url)) void linkChip(url);
		return false;
	};

	dropped.current = (v, e, moved) => {
		if (moved || noFiles) return false;
		const list = Array.from(e.dataTransfer?.files ?? []);
		if (!list.length) return false;
		const at = v.posAtCoords({ left: e.clientX, top: e.clientY })?.pos;
		void add(list, at);
		return true;
	};

	/** A pasted link a connected source knows becomes `#123 · title` in its place; else a quiet hint. */
	const linkChip = async (url: string) => {
		try {
			const {
				results: [res],
			} = await resolve.mutateAsync({ urls: [url] });
			if (!res || !("ref" in res)) {
				setHint(connectHint(url));
				return;
			}
			const v = view();
			const range = v ? findText(v.state.doc, url) : null;
			if (!v || !range) return;
			pickInto(v, range, {
				chip: "ref",
				ref: res.ref,
				url,
				...(res.tone ? { tone: res.tone } : {}),
			});
		} catch {
			// Unresolved: the link stays text.
		}
	};

	const pasteAsText = (key: string) => {
		const v = view();
		const a = parts.files.find((f) => f.key === key);
		if (!v || a?.pasted === undefined || a.pasted === null) return;
		const text = a.pasted;
		replaceChip(
			v,
			(x) => x.chip === "file" && x.key === key,
			(s) =>
				text.split("\n").flatMap((line, i) => {
					const out = [];
					if (i > 0 && s.schema.nodes.hardBreak)
						out.push(s.schema.nodes.hardBreak.create());
					if (line) out.push(s.schema.text(line));
					return out;
				}),
		);
		v.focus();
	};
	const chipContext: ChipContextValue = {
		files,
		pasteAsText,
		pasteRefusal: (text) =>
			docText(doc).length + text.length > DRAFT_TEXT_MAX_CHARS
				? `Over ${DRAFT_TEXT_MAX_CHARS.toLocaleString("en")} characters`
				: null,
	};

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
							onClick={() => onRepeat(parts.text)}
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

	const clipHint =
		agentFacts.images === true
			? "Attach files or a screenshot"
			: agentFacts.images === false
				? `${agentLabel} can't take images. Other files attach.`
				: "Images: not checked yet. Other files attach.";
	const docked = !!dock;
	return (
		<div
			ref={root}
			className="flex flex-col gap-1"
			data-testid="thread-composer"
		>
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
			{/* The menu floats above the box at one width and never pushes the page (sheet §0.5, §5). */}
			<div className="relative" ref={menuAnchor}>
				{menuOpen &&
					trigger &&
					(result || search.isFetching || search.error) && (
						<div
							className="absolute bottom-full left-0 z-30 mb-1.5 w-[min(100%,480px)]"
							style={{ "--menu-room": `${menuRoom}px` } as CSSProperties}
						>
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
						</div>
					)}
				{/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the editor and the attach button are the keyboard paths. */}
				<div
					className={cn(
						"overflow-hidden rounded-[10px] bg-surface-2 focus-within:ring-2 focus-within:ring-accent/60",
						floating && "shadow-float",
					)}
					data-testid="composer-box"
					onDragOver={(e) => {
						if (!noFiles && e.dataTransfer?.types.includes("Files"))
							e.preventDefault();
					}}
					onDrop={(e) => {
						// The editor takes drops on itself at the drop point; this catches the rest of the box.
						if (e.defaultPrevented || noFiles) return;
						const list = Array.from(e.dataTransfer?.files ?? []);
						if (!list.length) return;
						e.preventDefault();
						void add(list);
					}}
				>
					{/* One surface inside the box (sheet §5): the dock sits on it over a hairline, and hides when empty. */}
					{docked && (
						<div
							className="relative flex flex-col gap-2.5 px-3 pt-2.5 pb-2 after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-hairline empty:hidden"
							data-testid="composer-dock"
						>
							{dock}
						</div>
					)}
					<PromptInput
						data-live={live ? "" : undefined}
						className="[&>[data-slot=input-group]]:bg-transparent"
						onSubmit={() => void submit(false)}
					>
						<PromptInputBody>
							{!agentless && (
								<span id={keysId} className="sr-only">
									Shift+Tab changes the permission level. {FOCUS_BACK}
								</span>
							)}
							<ChipContext.Provider value={chipContext}>
								<EditorContent
									editor={editor}
									className="w-full min-w-0 px-3 pt-2.5"
									data-testid="composer-editor"
								/>
							</ChipContext.Provider>
						</PromptInputBody>
						<PromptInputFooter className="-ml-1.5">
							{/* One row on a phone: chips keep full labels and scroll sideways, Send stays put (#1020). */}
							<PromptInputTools
								className="min-w-0 flex-1 flex-wrap gap-0.5 gap-y-1 [&>*]:shrink-0"
								data-testid="composer-chips"
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
								{tools}
								{!agentless && (
									<LockedWhy why={locked ? KEPT : null}>
										<ModelChip
											harness={harness}
											model={choice.model}
											disabled={locked || blocked}
											onPick={(h, m) =>
												onChoice({ harnessId: h.id as HarnessId, model: m })
											}
										/>
									</LockedWhy>
								)}
								{!agentless && (
									<LockedWhy why={locked ? KEPT : null}>
										<EffortChip
											harness={harness}
											model={choice.model}
											effort={choice.effort}
											disabled={locked || blocked}
											onEffort={(effort) => onChoice({ effort })}
											onModel={(model) => onChoice({ model })}
										/>
									</LockedWhy>
								)}
								{!agentless && (
									<ModeChip
										harness={harness}
										level={choice.accessLevel}
										agentMode={choice.agentMode ?? null}
										onPick={(next) => onChoice(next)}
										lockedHint={accessHint ?? (locked ? KEPT : undefined)}
										disabled={blocked}
										levelsOnly={levelModesOnly}
									/>
								)}
								{context && (
									<ContextControl
										choice={context}
										compact={compactNext}
										onCompact={setCompactNext}
										onBreakdown={openContextMeter}
									/>
								)}
							</PromptInputTools>
							<div className="ml-auto flex shrink-0 items-center gap-0.5">
								{action}
							</div>
						</PromptInputFooter>
					</PromptInput>
				</div>
			</div>
			{(blocked || refusal || notice) && (
				<p
					className={cn(
						"px-3 text-meta",
						refusal ? "text-danger" : "text-text-2",
					)}
					data-testid={refusal ? "composer-refusal" : "composer-blocked"}
				>
					{refusal ?? (blocked ? blockedReason : notice)}
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
