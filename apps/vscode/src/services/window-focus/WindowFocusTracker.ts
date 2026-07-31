import * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"

/**
 * Tracks whether the VS Code window is focused.
 *
 * In Remote-SSH scenarios the extension host runs on the remote server, but
 * `vscode.window.state.focused` and `onDidChangeWindowState` are proxied from
 * the local UI, so this correctly reflects the user's local window focus state
 * in both local and remote contexts.
 */
export class WindowFocusTracker {
	private focused: boolean
	private disposables: vscode.Disposable[] = []

	constructor() {
		// `vscode.window.state` may be undefined in the standalone runtime stubs;
		// treat that as "not focused" so notifications fire.
		this.focused = vscode.window.state?.focused ?? false

		try {
			const sub = vscode.window.onDidChangeWindowState((state) => {
				this.focused = state?.focused ?? false
			})
			this.disposables.push(sub)
		} catch (error) {
			Logger.warn("[WindowFocusTracker] onDidChangeWindowState unavailable; assuming never focused", error)
		}
	}

	/** Returns `true` when the VS Code window currently has focus. */
	isFocused(): boolean {
		return this.focused
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose()
		}
		this.disposables = []
	}
}
