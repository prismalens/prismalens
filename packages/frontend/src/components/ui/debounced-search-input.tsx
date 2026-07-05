// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { Input } from "./input";

interface DebouncedSearchInputProps {
	value: string;
	onValueChange: (value: string) => void;
	placeholder?: string;
	delay?: number;
	className?: string;
}

export function DebouncedSearchInput({
	value,
	onValueChange,
	placeholder = "Search...",
	delay = 300,
	className,
}: DebouncedSearchInputProps) {
	const [internalValue, setInternalValue] = useState(value);
	const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

	// Sync internal state when external value changes (e.g. "Clear filters")
	useEffect(() => {
		setInternalValue(value);
	}, [value]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}
		};
	}, []);

	function handleChange(newValue: string) {
		setInternalValue(newValue);
		if (timerRef.current) {
			clearTimeout(timerRef.current);
		}
		timerRef.current = setTimeout(() => {
			onValueChange(newValue);
		}, delay);
	}

	return (
		<div className={cn("relative", className)}>
			<Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
			<Input
				placeholder={placeholder}
				value={internalValue}
				onChange={(e) => handleChange(e.target.value)}
				className="pl-8"
			/>
		</div>
	);
}
