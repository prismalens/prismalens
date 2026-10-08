// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * AI Elements PromptInput (registry.ai-sdk.dev/prompt-input.json, ai-elements 1.9.0), owned:
 * the parts the box uses; `ai` types are local unions and `nanoid` is gone (#673).
 */
import { ArrowUp, Loader2, Square } from "lucide-react";
import type {
	ComponentProps,
	FormEvent,
	HTMLAttributes,
	KeyboardEvent,
} from "react";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

/** The registry's `ChatStatus` from `ai`, without the dependency. */
export type PromptInputStatus = "ready" | "submitted" | "streaming" | "error";

export type PromptInputProps = Omit<
	HTMLAttributes<HTMLFormElement>,
	"onSubmit"
> & {
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function PromptInput({
	className,
	onSubmit,
	children,
	...props
}: PromptInputProps) {
	return (
		<form
			className={cn("w-full", className)}
			onSubmit={(e) => {
				e.preventDefault();
				onSubmit(e);
			}}
			{...props}
		>
			<InputGroup className="px-3 pt-2.5 pb-2">{children}</InputGroup>
		</form>
	);
}

export function PromptInputBody({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("contents", className)} {...props} />;
}

export type PromptInputTextareaProps = ComponentProps<
	typeof InputGroupTextarea
>;

/**
 * Enter submits unless the caller's own key handler took the key first; the
 * registry's rule, kept so a plain box works with no handler.
 */
export function PromptInputTextarea({
	className,
	onKeyDown,
	...props
}: PromptInputTextareaProps) {
	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		onKeyDown?.(e);
		if (e.defaultPrevented) return;
		if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
		e.preventDefault();
		const submit = e.currentTarget.form?.querySelector<HTMLButtonElement>(
			'button[type="submit"]',
		);
		if (!submit?.disabled) e.currentTarget.form?.requestSubmit();
	};
	return (
		<InputGroupTextarea
			name="message"
			rows={1}
			className={cn(
				"field-sizing-content max-h-40 min-h-11 py-0.5 leading-5",
				className,
			)}
			onKeyDown={handleKeyDown}
			{...props}
		/>
	);
}

export function PromptInputFooter({
	className,
	...props
}: Omit<ComponentProps<typeof InputGroupAddon>, "align">) {
	return (
		<InputGroupAddon
			align="block-end"
			className={cn("mt-1 justify-between gap-1", className)}
			{...props}
		/>
	);
}

export function PromptInputTools({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn("flex min-w-0 items-center gap-1", className)}
			{...props}
		/>
	);
}

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton>;

export function PromptInputButton({
	variant = "text",
	className,
	...props
}: PromptInputButtonProps) {
	return (
		<InputGroupButton
			type="button"
			variant={variant}
			className={cn("px-2", className)}
			{...props}
		/>
	);
}

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
	status?: PromptInputStatus;
};

/** The round send: an arrow, a spinner while it goes, a square while it streams. */
export function PromptInputSubmit({
	className,
	variant = "primary",
	status,
	children,
	...props
}: PromptInputSubmitProps) {
	const icon =
		status === "submitted" ? (
			<Loader2 className="size-4 animate-spin" />
		) : status === "streaming" ? (
			<Square className="size-3.5 fill-current" />
		) : (
			<ArrowUp className="size-4" />
		);
	return (
		<InputGroupButton
			aria-label="Send"
			type="submit"
			variant={variant}
			className={cn(
				"size-8 rounded-full p-0 disabled:pointer-events-auto disabled:cursor-default disabled:bg-surface-3 disabled:text-text-3 disabled:opacity-100",
				className,
			)}
			{...props}
		>
			{children ?? icon}
		</InputGroupButton>
	);
}
