"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface TagInputProps {
	tags: string[];
	onChange: (tags: string[]) => void;
	placeholder?: string;
	className?: string;
	disabled?: boolean;
}

export function TagInput({
	tags,
	onChange,
	placeholder = "Add tag...",
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
				"flex flex-wrap gap-2 p-2 border rounded-md min-h-[42px] focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
				disabled && "opacity-50 cursor-not-allowed",
				className,
			)}
		>
			{tags.map((tag) => (
				<Badge key={tag} variant="secondary" className="gap-1">
					{tag}
					{!disabled && (
						<button
							type="button"
							onClick={() => removeTag(tag)}
							className="hover:bg-muted-foreground/20 rounded-full p-0.5"
						>
							<X className="h-3 w-3" />
							<span className="sr-only">Remove {tag}</span>
						</button>
					)}
				</Badge>
			))}
			<Input
				value={inputValue}
				onChange={(e) => setInputValue(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={tags.length === 0 ? placeholder : ""}
				disabled={disabled}
				className="flex-1 min-w-[100px] border-0 p-0 h-auto focus-visible:ring-0 focus-visible:ring-offset-0"
			/>
		</div>
	);
}
