// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { PickFolderResult } from "@prismalens/contracts";

/** What the dialog's process did: `code` is null when it could not start or was killed. */
export interface DialogRun {
	code: number | null;
	stdout: string;
	stderr: string;
}

export interface DialogDeps {
	platform: NodeJS.Platform;
	env: NodeJS.ProcessEnv;
	run: (command: string, args: readonly string[]) => Promise<DialogRun>;
	hasCommand: (name: string) => Promise<boolean>;
}

interface DialogTool {
	command: string;
	args: readonly string[];
}

const TITLE = "Select a folder";
/** A dialog left open this long is abandoned and counts as cancelled. */
const DIALOG_MS = 10 * 60_000;

// Explorer's own folder dialog (IFileDialog, FOS_PICKFOLDERS). A 1px topmost owner puts it in
// front of the browser; the dialog opens at the owner's corner, so a helper thread centres it on
// the monitor under the cursor. STA is required by the shell. Cancel (0x800704C7) prints nothing.
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class PlFolderDialog {
	delegate bool EnumProc(IntPtr hwnd, IntPtr param);
	struct RECT { public int L, T, R, B; }
	[DllImport("user32.dll")] static extern bool SetProcessDPIAware();
	[DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
	[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
	[DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
	[DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
	[DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
	[DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
	public static void Aware() { SetProcessDPIAware(); }
	// A background process may not take the foreground; a bare Alt tap lifts that lock.
	public static void Front(IntPtr hwnd) {
		keybd_event(0x12, 0, 0, UIntPtr.Zero);
		keybd_event(0x12, 0, 2, UIntPtr.Zero);
		SetForegroundWindow(hwnd);
	}
	static void Centre(string title, int cx, int cy) {
		uint me = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
		int moves = 0;
		for (int i = 0; i < 80 && moves < 2; i++) {
			Thread.Sleep(moves == 0 ? 50 : 500);
			bool moved = false;
			EnumWindows(delegate(IntPtr hwnd, IntPtr param) {
				uint pid;
				GetWindowThreadProcessId(hwnd, out pid);
				if (pid != me) return true;
				StringBuilder text = new StringBuilder(256);
				GetWindowText(hwnd, text, 256);
				if (text.ToString() != title) return true;
				RECT r;
				GetWindowRect(hwnd, out r);
				SetWindowPos(hwnd, IntPtr.Zero, cx - (r.R - r.L) / 2, cy - (r.B - r.T) / 2, 0, 0, 0x0015);
				moved = true;
				return false;
			}, IntPtr.Zero);
			if (moved) moves++;
		}
	}
	[ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialog {}
	[ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IFileDialog {
		[PreserveSig] int Show(IntPtr parent);
		void SetFileTypes(uint count, IntPtr types);
		void SetFileTypeIndex(uint index);
		void GetFileTypeIndex(out uint index);
		void Advise(IntPtr events, out uint cookie);
		void Unadvise(uint cookie);
		void SetOptions(uint options);
		void GetOptions(out uint options);
		void SetDefaultFolder(IShellItem item);
		void SetFolder(IShellItem item);
		void GetFolder(out IShellItem item);
		void GetCurrentSelection(out IShellItem item);
		void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
		void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
		void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
		void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
		void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
		void GetResult(out IShellItem item);
	}
	[ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IShellItem {
		void BindToHandler(IntPtr bc, ref Guid handler, ref Guid riid, out IntPtr ppv);
		void GetParent(out IShellItem parent);
		void GetDisplayName(uint form, [MarshalAs(UnmanagedType.LPWStr)] out string name);
	}
	public static string Pick(IntPtr owner, string title, int cx, int cy) {
		IFileDialog dialog = (IFileDialog)new FileOpenDialog();
		uint options;
		dialog.GetOptions(out options);
		dialog.SetOptions(options | 0x20 | 0x40 | 0x800);
		dialog.SetTitle(title);
		Thread mover = new Thread(delegate() { Centre(title, cx, cy); });
		mover.IsBackground = true;
		mover.Start();
		int hr = dialog.Show(owner);
		if (hr == unchecked((int)0x800704C7)) return "";
		if (hr != 0) Marshal.ThrowExceptionForHR(hr);
		IShellItem item;
		dialog.GetResult(out item);
		string path;
		item.GetDisplayName(0x80058000, out path);
		return path;
	}
}
'@
[PlFolderDialog]::Aware()
[System.Windows.Forms.Application]::EnableVisualStyles()
$area = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = 'None'
$owner.Opacity = 0.01
$owner.StartPosition = 'Manual'
$owner.Bounds = New-Object System.Drawing.Rectangle ($area.Left + [int]($area.Width / 2)), ($area.Top + [int]($area.Height / 2)), 1, 1
$owner.Show()
[PlFolderDialog]::Front($owner.Handle)
try {
	[Console]::Out.Write([PlFolderDialog]::Pick($owner.Handle, '${TITLE}', $owner.Left, $owner.Top))
} finally {
	$owner.Dispose()
}
`;

/** The command that opens a folder dialog here, or null when this machine has none. */
export async function folderDialogTool(
	deps: Pick<DialogDeps, "platform" | "env" | "hasCommand">,
): Promise<DialogTool | null> {
	if (deps.platform === "win32") {
		return {
			command: "powershell.exe",
			args: [
				"-NoProfile",
				"-NonInteractive",
				"-STA",
				"-ExecutionPolicy",
				"Bypass",
				"-EncodedCommand",
				Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64"),
			],
		};
	}
	if (deps.platform === "darwin") {
		return {
			command: "osascript",
			args: ["-e", `POSIX path of (choose folder with prompt "${TITLE}")`],
		};
	}
	if (!deps.env.DISPLAY && !deps.env.WAYLAND_DISPLAY) return null;
	if (await deps.hasCommand("zenity")) {
		return {
			command: "zenity",
			args: ["--file-selection", "--directory", `--title=${TITLE}`],
		};
	}
	if (await deps.hasCommand("kdialog")) {
		return {
			command: "kdialog",
			args: ["--getexistingdirectory", deps.env.HOME ?? "/", "--title", TITLE],
		};
	}
	return null;
}

/** A path the dialog printed: one line, a folder's trailing separator dropped (a root keeps it). */
function chosenPath(stdout: string): string | null {
	const line = stdout.replace(/\r?\n$/, "");
	if (!line.trim()) return null;
	return line.length > 1 &&
		/[\\/]$/.test(line) &&
		!/^[A-Za-z]:[\\/]$/.test(line)
		? line.slice(0, -1)
		: line;
}

let open: Promise<PickFolderResult> | undefined;

/**
 * Opens the folder dialog on this machine and answers the pick. A second call while one
 * dialog is open joins it, so the dialogs never stack. Cancel is every non-error exit with no
 * path: zenity, kdialog and osascript (-128) all end that way.
 */
export function pickNativeFolder(deps: DialogDeps): Promise<PickFolderResult> {
	open ??= (async (): Promise<PickFolderResult> => {
		const tool = await folderDialogTool(deps);
		if (!tool) return { status: "unavailable" };
		const ran = await deps.run(tool.command, tool.args);
		if (ran.code === 0) {
			const path = chosenPath(ran.stdout);
			return path ? { status: "picked", path } : { status: "cancelled" };
		}
		if (ran.code === 1 || ran.stderr.includes("(-128)")) {
			return { status: "cancelled" };
		}
		return { status: "unavailable" };
	})().finally(() => {
		open = undefined;
	});
	return open;
}

export const systemDialogDeps: DialogDeps = {
	platform: process.platform,
	env: process.env,
	run: (command, args) =>
		new Promise((resolve) => {
			execFile(
				command,
				[...args],
				{ encoding: "utf8", windowsHide: true, timeout: DIALOG_MS },
				(error, stdout, stderr) => {
					const code = error
						? typeof error.code === "number"
							? error.code
							: null
						: 0;
					resolve({ code: error?.killed ? 1 : code, stdout, stderr });
				},
			);
		}),
	hasCommand: async (name) => {
		for (const dir of (process.env.PATH ?? "").split(delimiter)) {
			if (!dir) continue;
			try {
				await access(join(dir, name), constants.X_OK);
				return true;
			} catch {}
		}
		return false;
	},
};
