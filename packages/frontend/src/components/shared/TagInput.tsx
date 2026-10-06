// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { cn } from "@/lib/utils";

export interface TagInputProps {
	tags: string[];
	onChange: (tags: string[]) => void;
	placeholder?: string;
	className?: string;
	disabled?: boolean;
}

/** Tags on one line that scrolls sideways, so adding one never changes the form's height. */
export function TagInput({
	tags,
	onChange,
	placeholder = "Enter after each",
	className,
	disabled = false,
}: TagInputProps) {
	const [inputValue, setInputValue] = useState("");

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" || e.key === ",") {
			e.preventDefault();
			const newTag = inputValue.trim().toLowerCase();
			if (newTag && !tags.includes(newTag)) {
				onChange([...tags, newTag]);
			}
			setInputValue("");
		} else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
			onChange(tags.slice(0, -1));
		}
	};

	const removeTag = (tagToRemove: string) => {
		if (!disabled) {
			onChange(tags.filter((tag) => tag !== tagToRemove));
		}
	};

	return (
		<div
			className={cn(
				"flex h-8 min-w-0 items-center gap-1 overflow-x-auto rounded-control bg-surface-2 px-1.5 md:h-7 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent [[data-pool]_&]:bg-well-in-pool [[role=dialog]_&]:bg-surface-3",
				disabled && "cursor-not-allowed opacity-50",
				className,
			)}
		>
			{tags.map((tag) => (
				<span
					key={tag}
					className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-[4px] bg-surface-4 pr-0.5 pl-1.5 text-meta text-text-1"
				>
					{tag}
					{!disabled && (
						<button
							type="button"
							onClick={() => removeTag(tag)}
							aria-label={`Remove ${tag}`}
							className="inline-flex size-4 items-center justify-center rounded-[3px] text-text-2 hover:text-text-1"
						>
							<X className="size-3" />
						</button>
					)}
				</span>
			))}
			<input
				value={inputValue}
				onChange={(e) => setInputValue(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={tags.length === 0 ? placeholder : ""}
				disabled={disabled}
				className="h-full min-w-16 flex-1 bg-transparent px-1 text-[16px] text-text-1 outline-none placeholder:text-text-3 md:text-body"
			/>
		</div>
	);
}
