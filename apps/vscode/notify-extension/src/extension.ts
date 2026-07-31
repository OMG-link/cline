import * as vscode from "vscode"
import { showSystemNotification } from "./notifications"

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"cline-notify.show",
			async (args: { title: string; body: string; subtitle?: string }) => {
				try {
					await showSystemNotification({
						subtitle: args.subtitle ?? args.title,
						message: args.body,
					})
				} catch (err) {
					console.error("[cline-notify] Failed to show notification:", err)
				}
			},
		),
	)
}

export function deactivate(): void {}
