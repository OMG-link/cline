import type { ClineMessage } from "@shared/ExtensionMessage"
import { act, renderHook } from "@testing-library/react"
import type { MutableRefObject } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useScrollBehavior } from "./useScrollBehavior"

const commandMessage: ClineMessage = {
	ts: 1,
	type: "ask",
	ask: "command",
	text: "echo hi",
}

// Builds a fake scroller element to attach listeners to. The hook never reads
// scroll metrics; the stubbed values are unused but keep the shape explicit.
function makeScroller({
	scrollHeight,
	clientHeight,
	scrollTop,
}: {
	scrollHeight: number
	clientHeight: number
	scrollTop: number
}) {
	const el = document.createElement("div")
	Object.defineProperties(el, {
		scrollHeight: { configurable: true, value: scrollHeight },
		clientHeight: { configurable: true, value: clientHeight },
		scrollTop: { configurable: true, value: scrollTop, writable: true },
	})
	return el
}

describe("useScrollBehavior", () => {
	// Collects the ResizeObserver callback(s) the hook registers so tests can
	// fire them to simulate content/viewport size changes.
	let roCallbacks: Array<(entries: unknown[]) => void>

	beforeEach(() => {
		roCallbacks = []
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(cb: (entries: unknown[]) => void) {
					roCallbacks.push(cb)
				}
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		)
		// Fake timers: prevents cancelFollowing's setTimeout from leaking across
		// tests. performance.now() is faked so advanceTimersByTime drives lock
		// deadlines.
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.clearAllTimers()
		vi.useRealTimers()
	})

	function fireResize() {
		act(() => {
			for (const cb of roCallbacks) cb([])
		})
	}

	// pinToBottom is rAF-throttled; flush one frame so the scrollTo runs.
	function flushRaf() {
		act(() => {
			vi.advanceTimersByTime(16)
		})
	}

	it("pins to bottom on resize when following is enabled", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
		const scrollTo = vi.fn()
		;(result.current.virtuosoRef as MutableRefObject<{ scrollTo: typeof scrollTo } | null>).current = {
			scrollTo,
		}

		// isFollowing defaults to true (following enabled).
		const scroller = makeScroller({ scrollHeight: 500, clientHeight: 100, scrollTop: 400 })
		act(() => {
			result.current.setScrollerEl(scroller)
		})

		scrollTo.mockClear()
		fireResize()
		flushRaf()

		expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: Number.MAX_SAFE_INTEGER, behavior: "auto" }))
	})

	it("does not pin when following is off (isFollowing=false)", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
		const scrollTo = vi.fn()
		;(result.current.virtuosoRef as MutableRefObject<{ scrollTo: typeof scrollTo } | null>).current = {
			scrollTo,
		}

		const scroller = makeScroller({ scrollHeight: 500, clientHeight: 100, scrollTop: 100 })
		act(() => {
			result.current.setScrollerEl(scroller)
		})

		// Turn following off (as an upward gesture would).
		act(() => {
			result.current.cancelFollowing()
		})

		scrollTo.mockClear()
		fireResize()

		expect(scrollTo).not.toHaveBeenCalled()
	})

	it("disables following when a user expands a row", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [commandMessage], {}, vi.fn()))

		act(() => {
			result.current.toggleRowExpansion(commandMessage.ts)
		})

		expect(result.current.getFollowing()).toBe(false)
	})

	it("keeps following enabled when command output expands programmatically", () => {
		const { result } = renderHook(() => useScrollBehavior([], [], [commandMessage], {}, vi.fn()))

		act(() => {
			result.current.toggleRowExpansion(commandMessage.ts, { preserveAutoScroll: true })
		})

		expect(result.current.getFollowing()).toBe(true)
	})

	describe("handleTotalListHeightChanged", () => {
		it("calls scrollTo when following is enabled", () => {
			const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
			const scrollTo = vi.fn()
			;(result.current.virtuosoRef as MutableRefObject<{ scrollTo: typeof scrollTo } | null>).current = {
				scrollTo,
			}
			const scroller = makeScroller({ scrollHeight: 500, clientHeight: 100, scrollTop: 400 })
			act(() => {
				result.current.setScrollerEl(scroller)
			})

			scrollTo.mockClear()
			act(() => {
				result.current.handleTotalListHeightChanged()
			})
			flushRaf()

			expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: Number.MAX_SAFE_INTEGER, behavior: "auto" }))
		})

		it("does not call scrollTo when following is off", () => {
			const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
			const scrollTo = vi.fn()
			;(result.current.virtuosoRef as MutableRefObject<{ scrollTo: typeof scrollTo } | null>).current = {
				scrollTo,
			}
			const scroller = makeScroller({ scrollHeight: 500, clientHeight: 100, scrollTop: 400 })
			act(() => {
				result.current.setScrollerEl(scroller)
			})

			// Disable AFTER setup so earlier effects don't override it.
			act(() => {
				result.current.cancelFollowing()
			})
			scrollTo.mockClear()
			act(() => {
				result.current.handleTotalListHeightChanged()
			})

			expect(scrollTo).not.toHaveBeenCalled()
		})
	})

	describe("position-driven resume (handleAtBottomChange)", () => {
		it("resumes following after cancel lock elapses", () => {
			const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
			act(() => {
				result.current.cancelFollowing()
			})
			// Advance past the cancel lock so tryResumeFollow is not blocked.
			act(() => {
				vi.advanceTimersByTime(251)
			})

			act(() => {
				result.current.handleAtBottomChange(true)
			})
			expect(result.current.getFollowing()).toBe(true)
		})

		// Leaving the bottom must NOT disable following — that was the root cause of
		// the content-growth bug (Mermaid/code-block height jumps look identical to
		// user scroll at the position level). Disabling is now input-driven only.
		it("does not disable following when handleAtBottomChange(false)", () => {
			const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))

			act(() => {
				result.current.handleAtBottomChange(false)
			})

			expect(result.current.getFollowing()).toBe(true)
		})
		it("resumes following with no cancel lock (e.g. after row expansion)", () => {
			const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
			// toggleRowExpansion sets following=false without arming the cancel lock
			act(() => {
				result.current.toggleRowExpansion(123)
			})
			expect(result.current.getFollowing()).toBe(false)

			act(() => {
				result.current.handleAtBottomChange(true)
			})
			expect(result.current.getFollowing()).toBe(true)
		})
		it("scrollToBottom re-engages following after cancel", () => {
			const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
			act(() => {
				result.current.cancelFollowing()
			})
			expect(result.current.getFollowing()).toBe(false)

			act(() => {
				result.current.scrollToBottom()
			})
			expect(result.current.getFollowing()).toBe(true)
		})
	})

	describe("input-driven following (cancel-lock state machine)", () => {
		it("cancels following on upward wheel / up-arrow / pointerdown", () => {
			const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
			const scroller = makeScroller({ scrollHeight: 1000, clientHeight: 100, scrollTop: 900 })
			act(() => {
				result.current.setScrollerEl(scroller)
			})
			expect(result.current.getFollowing()).toBe(true)

			// Upward wheel (deltaY < 0) cancels.
			act(() => {
				scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }))
			})
			expect(result.current.getFollowing()).toBe(false)

			// Re-enable, then ArrowUp cancels.
			act(() => {
				result.current.scrollToBottom()
				scroller.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }))
			})
			expect(result.current.getFollowing()).toBe(false)

			// Re-enable, then pointerdown cancels (treated as upward intent).
			act(() => {
				result.current.scrollToBottom()
				scroller.dispatchEvent(new Event("pointerdown"))
			})
			expect(result.current.getFollowing()).toBe(false)
		})

		it("does not cancel on downward wheel / down-arrow / PageDown", () => {
			const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
			const scroller = makeScroller({ scrollHeight: 1000, clientHeight: 100, scrollTop: 900 })
			act(() => {
				result.current.setScrollerEl(scroller)
			})
			expect(result.current.getFollowing()).toBe(true)

			act(() => {
				scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }))
				scroller.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }))
				scroller.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }))
			})
			expect(result.current.getFollowing()).toBe(true)
		})

		it("recovers following after pointerdown cancels, once the cancel lock elapses at the bottom", () => {
			const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
			const scroller = makeScroller({ scrollHeight: 1000, clientHeight: 100, scrollTop: 900 })
			act(() => {
				result.current.setScrollerEl(scroller)
			})
			// pointerdown cancels following and arms the fixed cancel lock.
			act(() => {
				scroller.dispatchEvent(new Event("pointerdown"))
			})
			expect(result.current.getFollowing()).toBe(false)

			// Still at the bottom; resume is blocked while the lock is active.
			act(() => {
				result.current.handleAtBottomChange(true)
			})
			expect(result.current.getFollowing()).toBe(false)

			// Once the lock elapses, the pending resume re-check fires.
			act(() => {
				vi.advanceTimersByTime(251)
			})
			expect(result.current.getFollowing()).toBe(true)
		})

		it("resumes following after the fixed cancel lock elapses, once the user is at the bottom", () => {
			const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
			const scroller = makeScroller({ scrollHeight: 1000, clientHeight: 100, scrollTop: 900 })
			act(() => {
				result.current.setScrollerEl(scroller)
			})

			// User scrolls up — cancels following, arms fixed cancel lock.
			act(() => {
				scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }))
			})
			expect(result.current.getFollowing()).toBe(false)

			// User reaches the bottom; resume is blocked by the cancel lock.
			act(() => {
				result.current.handleAtBottomChange(true)
			})
			expect(result.current.getFollowing()).toBe(false)

			// After the cancel lock elapses, the pending resume re-check fires.
			act(() => {
				vi.advanceTimersByTime(251)
			})
			expect(result.current.getFollowing()).toBe(true)
		})

		it("does not reset the cancel-follow lock on inputs during the lock (regression: mid-stream resume)", () => {
			const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
			const scroller = makeScroller({ scrollHeight: 1000, clientHeight: 100, scrollTop: 900 })
			act(() => {
				result.current.setScrollerEl(scroller)
			})
			// User scrolls up — cancels following, arms the FIXED cancel lock.
			act(() => {
				scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }))
			})
			expect(result.current.getFollowing()).toBe(false)

			// Upward inputs during the lock window must NOT re-arm it (the lock is
			// fixed; cancelFollowing early-returns once already cancelled).
			for (let i = 0; i < 5; i++) {
				act(() => {
					vi.advanceTimersByTime(40) // well under the lock window
					scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }))
				})
			}
			// Only ~200ms elapsed (5 × 40), still under the original 250ms lock.
			// The lock must NOT have been reset to now+250 by those inputs.

			// User reaches the bottom. Resume is still blocked because the ORIGINAL
			// lock (armed at the first input) hasn't elapsed yet.
			act(() => {
				result.current.handleAtBottomChange(true)
			})
			expect(result.current.getFollowing()).toBe(false)

			// Advance past the REMAINING original lock window (~50ms left) — NOT a
			// fresh 250ms. If the lock had been reset, this would still be blocked.
			act(() => {
				vi.advanceTimersByTime(60)
			})
			expect(result.current.getFollowing()).toBe(true)
		})

		it("does not resume if the user is not at the bottom after the cancel lock elapses", () => {
			const { result } = renderHook(() => useScrollBehavior([], [], [], {}, vi.fn()))
			const scroller = makeScroller({ scrollHeight: 1000, clientHeight: 100, scrollTop: 900 })
			act(() => {
				result.current.setScrollerEl(scroller)
			})
			act(() => {
				scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }))
			})
			// Never reach the bottom.
			act(() => {
				vi.advanceTimersByTime(251)
			})
			expect(result.current.getFollowing()).toBe(false)
		})
	})
})
