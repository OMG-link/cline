import { describe, expect, it, vi } from "vitest"
import { isClineManagedProvider } from "@/shared/utils/cline"
import { handleTurnEnded } from "./SdkController"
import { resolveWorkspaceRootPath } from "./workspace-root"

describe("isClineManagedProvider", () => {
	it("treats both Cline account providers as Cline providers", () => {
		expect(isClineManagedProvider("cline")).toBe(true)
		expect(isClineManagedProvider("cline-pass")).toBe(true)
		expect(isClineManagedProvider("anthropic")).toBe(false)
		expect(isClineManagedProvider(undefined)).toBe(false)
	})
})

describe("resolveWorkspaceRootPath", () => {
	it("uses the first non-empty workspace path when available", () => {
		expect(resolveWorkspaceRootPath(["", "/workspace"], "/Users/tester/Desktop")).toBe("/workspace")
	})

	it("falls back to Desktop when no workspace folder is open", () => {
		expect(resolveWorkspaceRootPath([], "/Users/tester/Desktop")).toBe("/Users/tester/Desktop")
	})
})

describe("handleTurnEnded", () => {
	it("fires a completion notification for the completed phase", () => {
		const notify = vi.fn()
		handleTurnEnded("completed", notify)
		expect(notify).toHaveBeenCalledWith({
			kind: "completion",
			message: "Task completed.",
		})
	})

	it("uses the waiting-for-you message for awaiting_followup phase", () => {
		const notify = vi.fn()
		handleTurnEnded("awaiting_followup", notify)
		expect(notify).toHaveBeenCalledWith({
			kind: "completion",
			message: "Cline is waiting for you.",
		})
	})
})
