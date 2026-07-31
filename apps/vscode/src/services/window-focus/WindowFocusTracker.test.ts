import { afterEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"
import { WindowFocusTracker } from "./WindowFocusTracker"

describe("WindowFocusTracker", () => {
	afterEach(() => {
		vi.restoreAllMocks()
		// Reset the stub state
		;(vscode.window as { state: { focused: boolean } }).state.focused = false
	})

	it("reads the initial focused state from vscode.window.state", () => {
		;(vscode.window as { state: { focused: boolean } }).state.focused = true
		const tracker = new WindowFocusTracker()
		expect(tracker.isFocused()).toBe(true)
		tracker.dispose()
	})

	it("defaults to not focused when state is undefined", () => {
		// Temporarily make state undefined to simulate standalone stubs
		const originalState = (vscode.window as { state?: unknown }).state
		;(vscode.window as { state?: unknown }).state = undefined
		const tracker = new WindowFocusTracker()
		expect(tracker.isFocused()).toBe(false)
		tracker.dispose()
		;(vscode.window as { state?: unknown }).state = originalState
	})

	it("updates focused state when onDidChangeWindowState fires", () => {
		let listener: ((e: unknown) => void) | undefined
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.spyOn(vscode.window, "onDidChangeWindowState").mockImplementation(((cb: (e: any) => void) => {
			listener = cb
			return { dispose: () => undefined }
		}) as any)

		const tracker = new WindowFocusTracker()
		expect(tracker.isFocused()).toBe(false)

		// Simulate window gaining focus
		listener?.({ focused: true, active: true })
		expect(tracker.isFocused()).toBe(true)

		// Simulate window losing focus
		listener?.({ focused: false, active: true })
		expect(tracker.isFocused()).toBe(false)

		tracker.dispose()
	})

	it("disposes the onDidChangeWindowState subscription", () => {
		const disposeSpy = vi.fn()
		vi.spyOn(vscode.window, "onDidChangeWindowState").mockReturnValue({ dispose: disposeSpy })

		const tracker = new WindowFocusTracker()
		tracker.dispose()
		expect(disposeSpy).toHaveBeenCalledOnce()
	})
})
