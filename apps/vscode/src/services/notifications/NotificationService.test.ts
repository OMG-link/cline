import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

// Mock the OS notification module so we can assert calls without spawning processes.
vi.mock("@/integrations/notifications", () => ({
	showSystemNotification: vi.fn().mockResolvedValue(undefined),
}))

import { showSystemNotification } from "@/integrations/notifications"
import { NotificationService } from "./NotificationService"

function makeStateManager(enableNotifications: boolean) {
	return {
		getGlobalSettingsKey: vi.fn().mockReturnValue({
			enableNotifications,
		}),
	} as never
}

function makeFocusTracker(focused: boolean) {
	return { isFocused: () => focused } as never
}

describe("NotificationService", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Reset vscode env stub
		;(vscode.env as { remoteName: string | undefined }).remoteName = undefined
		;(vscode.window as { state: { focused: boolean } }).state.focused = false
	})

	afterEach(() => {
		;(vscode.env as { remoteName: string | undefined }).remoteName = undefined
	})

	it("does nothing when notifications are disabled", () => {
		const svc = new NotificationService({
			stateManager: makeStateManager(false),
			focusTracker: makeFocusTracker(false),
		})
		svc.notify({ kind: "approval", message: "test" })
		expect(showSystemNotification).not.toHaveBeenCalled()
	})

	it("does nothing when the window is focused", () => {
		const svc = new NotificationService({
			stateManager: makeStateManager(true),
			focusTracker: makeFocusTracker(true),
		})
		svc.notify({ kind: "approval", message: "test" })
		expect(showSystemNotification).not.toHaveBeenCalled()
	})

	it("dispatches an OS notification in local context (remoteName undefined)", () => {
		const svc = new NotificationService({
			stateManager: makeStateManager(true),
			focusTracker: makeFocusTracker(false),
		})
		svc.notify({ kind: "approval", message: "npm install" })

		expect(showSystemNotification).toHaveBeenCalledOnce()
		const call = (showSystemNotification as ReturnType<typeof vi.fn>).mock.calls[0][0]
		expect(call.subtitle).toBe("Approval Required")
		expect(call.message).toBe("npm install")
	})

	it("dispatches a completion notification with the correct subtitle", () => {
		const svc = new NotificationService({
			stateManager: makeStateManager(true),
			focusTracker: makeFocusTracker(false),
		})
		svc.notify({ kind: "completion", message: "Done" })

		expect(showSystemNotification).toHaveBeenCalledOnce()
		const call = (showSystemNotification as ReturnType<typeof vi.fn>).mock.calls[0][0]
		expect(call.subtitle).toBe("Task Complete")
	})

	it("dispatches a question notification with the correct subtitle", () => {
		const svc = new NotificationService({
			stateManager: makeStateManager(true),
			focusTracker: makeFocusTracker(false),
		})
		svc.notify({ kind: "question", message: "Which framework?" })

		expect(showSystemNotification).toHaveBeenCalledOnce()
		const call = (showSystemNotification as ReturnType<typeof vi.fn>).mock.calls[0][0]
		expect(call.subtitle).toBe("Question")
		expect(call.message).toBe("Which framework?")
	})

	it("dispatches companion command (not OS notification) in remote context", () => {
		;(vscode.env as { remoteName: string | undefined }).remoteName = "ssh-remote"
		const executeCommandSpy = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)

		const svc = new NotificationService({
			stateManager: makeStateManager(true),
			focusTracker: makeFocusTracker(false),
		})
		svc.notify({ kind: "approval", message: "test" })

		// OS notification is NOT called in remote context (runs on remote host, invisible to user)
		expect(showSystemNotification).not.toHaveBeenCalled()
		// Companion extension command is called
		expect(executeCommandSpy).toHaveBeenCalledWith(
			"cline-notify.show",
			expect.objectContaining({
				body: "test",
			}),
		)
		executeCommandSpy.mockRestore()
	})

	it("falls back to webview when companion extension is unavailable", async () => {
		;(vscode.env as { remoteName: string | undefined }).remoteName = "ssh-remote"
		const postToWebview = vi.fn().mockResolvedValue(true)
		// Simulate companion extension not installed (command rejects)
		const executeCommandSpy = vi.spyOn(vscode.commands, "executeCommand").mockRejectedValue(new Error("not found"))

		const svc = new NotificationService({
			stateManager: makeStateManager(true),
			focusTracker: makeFocusTracker(false),
		})
		svc.setPostToWebview(postToWebview)
		svc.notify({ kind: "approval", message: "test" })

		// Wait for the rejected promise to trigger the webview fallback
		await vi.waitFor(() => {
			expect(postToWebview).toHaveBeenCalledOnce()
		})
		const msg = postToWebview.mock.calls[0][0]
		expect(msg.type).toBe("cline_notification")
		expect(msg.notification.kind).toBe("approval")

		executeCommandSpy.mockRestore()
	})

	it("does not call OS notification in remote context without webview bridge", () => {
		;(vscode.env as { remoteName: string | undefined }).remoteName = "ssh-remote"
		const executeCommandSpy = vi.spyOn(vscode.commands, "executeCommand").mockRejectedValue(new Error("not found"))

		const svc = new NotificationService({
			stateManager: makeStateManager(true),
			focusTracker: makeFocusTracker(false),
		})
		svc.notify({ kind: "completion", message: "Done" })

		// OS notification is NOT called in remote context
		expect(showSystemNotification).not.toHaveBeenCalled()
		executeCommandSpy.mockRestore()
	})
})
