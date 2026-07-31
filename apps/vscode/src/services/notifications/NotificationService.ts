import * as vscode from "vscode"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import { showSystemNotification } from "@/integrations/notifications"
import type { WindowFocusTracker } from "@/services/window-focus/WindowFocusTracker"

export type NotificationKind = "approval" | "completion" | "error" | "question"

export interface NotificationRequest {
	kind: NotificationKind
	/** Short human-readable description (e.g. tool name + truncated command). */
	message: string
}

export interface NotificationServiceOptions {
	stateManager: StateManager
	focusTracker: WindowFocusTracker
	postToWebview?: (message: unknown) => Promise<boolean | undefined>
}

/**
 * Notification service.
 *
 * - **Local context**: OS-level notification via PowerShell toast / osascript /
 *   notify-send.
 *
 * - **Remote context** (Remote-SSH, dev-container): the extension host runs on
 *   the remote machine, so OS notification commands are invisible to the user.
 *   Only the companion local extension ("cline-notify.show" command, routed
 *   across hosts by VS Code) or the webview Notification API (renderer process,
 *   runs locally) can produce a toast on the user's machine.
 *
 * All paths are gated on:
 *   - `autoApprovalSettings.enableNotifications` being `true`
 *   - The VS Code window NOT being focused
 */
export class NotificationService {
	constructor(private readonly options: NotificationServiceOptions) {}

	private companionWarningShown = false

	setPostToWebview(fn: (message: unknown) => Promise<boolean | undefined>): void {
		this.options.postToWebview = fn
	}

	notify(request: NotificationRequest): void {
		try {
			if (!this.isEnabled()) {
				Logger.log("[NotificationService] Skipping: notifications disabled")
				return
			}
			if (this.options.focusTracker.isFocused()) {
				Logger.log("[NotificationService] Skipping: window is focused")
				return
			}
			Logger.log(`[NotificationService] Dispatching: kind=${request.kind} remote=${this.isRemote()}`)
			this.dispatch(request)
		} catch (error) {
			Logger.error("[NotificationService] notify failed", error)
		}
	}

	private isEnabled(): boolean {
		const settings = this.options.stateManager.getGlobalSettingsKey("autoApprovalSettings")
		return settings?.enableNotifications ?? false
	}

	private isRemote(): boolean {
		try {
			return vscode.env.remoteName !== undefined
		} catch {
			return false
		}
	}

	private dispatch(request: NotificationRequest): void {
		if (!this.isRemote()) {
			void this.notifyViaOS(request)
			return
		}

		// Remote: only companion/webview – OS commands run on the remote host
		// and are invisible to the user.
		const title = this.titleForKind(request.kind)
		const subtitle = this.subtitleForKind(request.kind)

		void vscode.commands
			.executeCommand("cline-notify.show", {
				title,
				subtitle,
				body: request.message,
			})
			.then(
				() => Logger.log("[NotificationService] Notified via companion extension"),
				() => {
					Logger.log("[NotificationService] Companion extension unavailable, trying webview")
					this.warnCompanionMissing()
					this.notifyViaWebview(request, title)
				},
			)
	}

	private titleForKind(kind: NotificationKind): string {
		switch (kind) {
			case "approval":
				return "Cline – Approval Required"
			case "completion":
				return "Cline – Task Complete"
			case "error":
				return "Cline – Error"
			case "question":
				return "Cline – Question"
		}
	}

	private subtitleForKind(kind: NotificationKind): string {
		switch (kind) {
			case "approval":
				return "Approval Required"
			case "completion":
				return "Task Complete"
			case "error":
				return "Error"
			case "question":
				return "Question"
		}
	}

	private warnCompanionMissing(): void {
		if (this.companionWarningShown) return
		this.companionWarningShown = true
		void vscode.window.showWarningMessage(
			"Cline notifications in remote sessions require the 'Cline Notify' companion extension. Install it to receive desktop notifications, or disable notifications in Auto-Approve settings to suppress this warning.",
		)
	}

	private notifyViaWebview(request: NotificationRequest, title: string): void {
		const postToWebview = this.options.postToWebview
		if (postToWebview) {
			void postToWebview({
				type: "cline_notification",
				notification: {
					kind: request.kind,
					title,
					body: request.message,
				},
			}).catch(() => {})
		}
	}

	private async notifyViaOS(request: NotificationRequest): Promise<void> {
		// showSystemNotification internally catches and logs all errors.
		await showSystemNotification({
			title: this.titleForKind(request.kind),
			subtitle: this.subtitleForKind(request.kind),
			message: request.message,
		})
	}
}
