import { ClineMessage } from "@shared/ExtensionMessage"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { VirtuosoHandle } from "react-virtuoso"
import { ScrollBehavior } from "../types/chatTypes"

// Height of the sticky user message header (padding + content)
const STICKY_HEADER_HEIGHT = 32
// Fixed lock after a cancel: blocks resume so an upward-gesture tail (trackpad
// inertia, edge bounce) does not immediately re-enable following.
const CANCEL_FOLLOW_LOCK_MS = 250

/**
 * Custom hook for managing chat scroll behavior: input-driven following,
 * scroll-to-message, and collapse/expand handling.
 */
export function useScrollBehavior(
	messages: ClineMessage[],
	visibleMessages: ClineMessage[],
	groupedMessages: (ClineMessage | ClineMessage[])[],
	expandedRows: Record<number, boolean>,
	setExpandedRows: React.Dispatch<React.SetStateAction<Record<number, boolean>>>,
): ScrollBehavior & {
	isAtBottom: boolean
	pendingScrollToMessage: number | null
	setPendingScrollToMessage: React.Dispatch<React.SetStateAction<number | null>>
	scrolledPastUserMessage: ClineMessage | null
} {
	// Refs
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	// Following state: useState drives UI re-renders, followingRef provides
	// the latest value to async callbacks (rAF, setTimeout, event listeners)
	// where a state snapshot would be stale. setFollowing is the sole write
	// entry point that keeps both in sync.
	const [isFollowing, setIsFollowing] = useState(true)
	const followingRef = useRef(true)
	const setFollowing = useCallback((next: boolean) => {
		if (followingRef.current === next) return
		followingRef.current = next
		setIsFollowing(next)
	}, [])
	const getFollowing = useCallback(() => followingRef.current, [])

	// State
	const [isAtBottom, setIsAtBottom] = useState(false)
	const [pendingScrollToMessage, setPendingScrollToMessage] = useState<number | null>(null)
	const [scrolledPastUserMessage, setScrolledPastUserMessage] = useState<ClineMessage | null>(null)
	// The Virtuoso scroller element, captured via the scrollerRef prop. Its size
	// is observed via ResizeObserver to drive bottom-following on panel resizes.
	const [scrollerEl, setScrollerElState] = useState<HTMLElement | null>(null)
	// Input-driven following (cancel-lock state machine). When true, new
	// content is pinned to the bottom. cancelFollowUntilRef is a fixed window after
	// a cancel that blocks resume. resumeCheckTimerRef retries resume after the
	// lock, in case the atBottom edge fired during the lock.
	const isAtBottomRef = useRef(false)
	const cancelFollowUntilRef = useRef(0)
	const resumeCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const pendingPinRef = useRef(false)

	// Find all user feedback messages
	const userFeedbackMessages = useMemo(() => {
		return visibleMessages.filter((msg) => msg.say === "user_feedback")
	}, [visibleMessages])

	// Track scroll position to detect which user message has been scrolled past
	// Shows the most recent user message that's above the current viewport
	const checkScrolledPastUserMessage = useCallback(() => {
		const scrollContainer = scrollContainerRef.current
		if (!scrollContainer || userFeedbackMessages.length === 0) {
			setScrolledPastUserMessage(null)
			return
		}

		const containerRect = scrollContainer.getBoundingClientRect()

		// Find the most recent (last in order) user message that's been scrolled past
		// We iterate from the end to find the latest one that's above the viewport
		let mostRecentScrolledPast: ClineMessage | null = null

		// Track if we've found any visible message element in the DOM
		// This helps us determine if missing elements are above or below viewport
		let foundAnyVisibleElement = false

		for (let i = userFeedbackMessages.length - 1; i >= 0; i--) {
			const msg = userFeedbackMessages[i]
			const messageElement = scrollContainer.querySelector(`[data-message-ts="${msg.ts}"]`) as HTMLElement

			if (messageElement) {
				foundAnyVisibleElement = true
				const messageRect = messageElement.getBoundingClientRect()
				// Message is scrolled past if its bottom edge is above (or near) the container's top
				// Add a small threshold so the pin appears slightly before message fully scrolls out
				const threshold = 10
				if (messageRect.bottom < containerRect.top + threshold) {
					mostRecentScrolledPast = msg
					break // Found the most recent one that's scrolled past
				}
			} else {
				// Element not in DOM - it's virtualized out
				// Only consider it scrolled past if we've already found a visible element after it
				// (meaning this missing element is above the viewport, not below)
				if (foundAnyVisibleElement) {
					mostRecentScrolledPast = msg
					break
				}
				// If we haven't found any visible elements yet, this message might be
				// below the viewport, so continue looking for visible elements
			}
		}

		setScrolledPastUserMessage(mostRecentScrolledPast)
	}, [userFeedbackMessages])

	// Use scroll event listener - attach to the scrollable element inside the container
	useEffect(() => {
		const scrollContainer = scrollContainerRef.current
		if (!scrollContainer) {
			return
		}

		// The scrollable element is the Virtuoso scroller or a child with overflow
		const findScrollableElement = () => {
			// Try finding the Virtuoso scroller
			const virtuosoScroller = scrollContainer.querySelector('[data-virtuoso-scroller="true"]') as HTMLElement
			if (virtuosoScroller) {
				return virtuosoScroller
			}
			// Fallback to the first child with scrollable class
			const scrollable = scrollContainer.querySelector(".scrollable") as HTMLElement
			return scrollable || scrollContainer
		}

		const scrollableElement = findScrollableElement()

		const handleScroll = () => {
			checkScrolledPastUserMessage()
		}

		scrollableElement.addEventListener("scroll", handleScroll, { passive: true })

		// Also check on mount and when dependencies change
		checkScrolledPastUserMessage()

		return () => {
			scrollableElement.removeEventListener("scroll", handleScroll)
		}
	}, [checkScrolledPastUserMessage])

	// Deduplicate: Virtuoso calls scrollerRef very frequently, often with the same
	// element reference. Only update state when it actually changes.
	const setScrollerEl = useCallback((el: HTMLElement | null) => {
		setScrollerElState((prev) => (prev === el ? prev : el))
	}, [])

	// Scroll to the bottom without touching following state, but only if
	// following is currently on. Used by the streaming-follow paths
	// (ResizeObserver, totalListHeightChanged) and InputSection's textarea-grow
	// re-pin. rAF-throttled: streaming can fire totalListHeightChanged many times
	// per frame; coalesce into one scrollTo.
	const pinToBottom = useCallback(() => {
		if (!getFollowing()) return
		if (pendingPinRef.current) return
		pendingPinRef.current = true
		requestAnimationFrame(() => {
			pendingPinRef.current = false
			if (getFollowing()) {
				virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: "auto" })
			}
		})
	}, [getFollowing])

	// Scroll to the bottom and re-enable following (clears the cancel lock).
	// The "program/user wants to follow" entry point: turn start, send message,
	// and the backstop effect on new message groups.
	const scrollToBottom = useCallback(
		(smooth = false) => {
			setFollowing(true)
			cancelFollowUntilRef.current = 0
			if (resumeCheckTimerRef.current) {
				clearTimeout(resumeCheckTimerRef.current)
				resumeCheckTimerRef.current = null
			}
			virtuosoRef.current?.scrollTo({
				top: Number.MAX_SAFE_INTEGER,
				behavior: smooth ? "smooth" : "auto",
			})
		},
		[setFollowing],
	)

	// ResizeObserver: pins to bottom on viewport/panel resizes while following.
	// Content-height changes are handled by totalListHeightChanged below.
	useEffect(() => {
		if (!scrollerEl || typeof ResizeObserver === "undefined") {
			return
		}
		const onResize = () => {
			pinToBottom()
		}
		const ro = new ResizeObserver(onResize)
		ro.observe(scrollerEl)
		onResize() // cover initial mount
		return () => ro.disconnect()
	}, [scrollerEl, pinToBottom])

	// Virtuoso's content-height-changed callback. Fires on every item measurement
	// change (including streaming text growth within the last row).
	const handleTotalListHeightChanged = useCallback(() => {
		pinToBottom()
	}, [pinToBottom])

	const scrollToMessage = useCallback(
		(messageIndex: number) => {
			setPendingScrollToMessage(messageIndex)

			const targetMessage = messages[messageIndex]
			if (!targetMessage) {
				setPendingScrollToMessage(null)
				return
			}

			const visibleIndex = visibleMessages.findIndex((msg) => msg.ts === targetMessage.ts)
			if (visibleIndex === -1) {
				setPendingScrollToMessage(null)
				return
			}

			let groupIndex = -1

			for (let i = 0; i < groupedMessages.length; i++) {
				const group = groupedMessages[i]
				if (Array.isArray(group)) {
					const messageInGroup = group.some((msg) => msg.ts === targetMessage.ts)
					if (messageInGroup) {
						groupIndex = i
						break
					}
				} else {
					if (group.ts === targetMessage.ts) {
						groupIndex = i
						break
					}
				}
			}

			if (groupIndex !== -1) {
				setPendingScrollToMessage(null)
				setFollowing(false)

				// Check if this is the first user feedback message (no sticky header would show when scrolling to it)
				const isFirstUserMessage =
					groupIndex === 0 || !visibleMessages.slice(0, visibleIndex).some((msg) => msg.say === "user_feedback")

				const stickyHeaderOffset = isFirstUserMessage ? 0 : STICKY_HEADER_HEIGHT

				// Use scrollToIndex with offset - Virtuoso handles this more reliably than manual scrollTo
				requestAnimationFrame(() => {
					virtuosoRef.current?.scrollToIndex({
						index: groupIndex,
						align: "start",
						behavior: "smooth",
						offset: -stickyHeaderOffset,
					})
				})
			}
		},
		[messages, visibleMessages, groupedMessages, setFollowing],
	)

	// scroll when user toggles certain rows
	const toggleRowExpansion = useCallback(
		(ts: number, options?: { preserveAutoScroll?: boolean }) => {
			const isCollapsing = expandedRows[ts] ?? false

			setExpandedRows((prev) => ({
				...prev,
				[ts]: !prev[ts],
			}))

			// User-initiated expansion: following was already cancelled by the
			// pointerdown that opened the row, so this is a belt-and-suspenders
			// write. Programmatic expansions (preserveAutoScroll) keep following on.
			if (!isCollapsing && !options?.preserveAutoScroll) {
				setFollowing(false)
			}
			// No re-pin on user-initiated collapse: a collapse is triggered by a
			// click inside the scroller, whose pointerdown already cancelled following
			// (following is off), so any re-pin in this function would be gated off.
			// Content height changes after the collapse re-trigger totalListHeightChanged,
			// which pins if following is still on (e.g. a programmatic collapse with
			// preserveAutoScroll).
		},
		[expandedRows, setExpandedRows, setFollowing],
	)

	// Backstop: pins to bottom on new message groups while following is on,
	// covering first mount and any case where the ResizeObserver hasn't attached
	// yet. Does NOT depend on isFollowing (state) because the effect only needs
	// to fire on new message groups, not on following-state transitions. If
	// following was just re-engaged, the next message group will trigger this.
	useEffect(() => {
		if (getFollowing() && groupedMessages.length > 0) {
			scrollToBottom()
		}
	}, [getFollowing, groupedMessages.length, scrollToBottom])

	useEffect(() => {
		if (pendingScrollToMessage !== null) {
			scrollToMessage(pendingScrollToMessage)
		}
	}, [pendingScrollToMessage, scrollToMessage])

	// Resumes following at the bottom once the cancel lock has elapsed.
	const tryResumeFollow = useCallback(() => {
		if (getFollowing()) return
		if (!isAtBottomRef.current) return
		if (performance.now() < cancelFollowUntilRef.current) return
		setFollowing(true)
		cancelFollowUntilRef.current = 0
	}, [getFollowing, setFollowing])

	// Cancels following and arms the fixed cancel lock. Reused by the input
	// listener and by turn-end's scroll-to-summary (both need to suppress the pin
	// while a programmatic scroll runs).
	const cancelFollowing = useCallback(() => {
		if (!getFollowing()) return
		setFollowing(false)
		cancelFollowUntilRef.current = performance.now() + CANCEL_FOLLOW_LOCK_MS
		if (resumeCheckTimerRef.current) clearTimeout(resumeCheckTimerRef.current)
		resumeCheckTimerRef.current = setTimeout(() => {
			resumeCheckTimerRef.current = null
			tryResumeFollow()
		}, CANCEL_FOLLOW_LOCK_MS)
	}, [getFollowing, setFollowing, tryResumeFollow])

	// Tracks whether the viewport is at the bottom and attempts resume when it
	// returns there. Does NOT disable following when leaving the bottom — that
	// was the root cause of the content-growth bug (Mermaid/code-block height
	// jumps are indistinguishable from user scroll at the position level).
	const handleAtBottomChange = useCallback(
		(atBottom: boolean) => {
			isAtBottomRef.current = atBottom
			setIsAtBottom(atBottom)
			if (atBottom) tryResumeFollow()
		},
		[tryResumeFollow],
	)

	// Input listener: cancels following on an upward gesture or any pointerdown.
	// Downward wheel/keyboard gestures are no-ops (the user is moving toward the
	// content they follow). Pointerdown is always treated as a cancel — any click
	// on the scroll area may stop following. Touch is covered by pointerdown
	// (touch fires pointerdown on all modern browsers), so no separate touch
	// handlers.
	useEffect(() => {
		const el = scrollerEl
		if (!el) return

		const onWheel = (e: WheelEvent) => {
			// deltaY < 0 = scroll up (toward older messages). Ctrl+wheel is zoom
			// (pinch gesture), not scroll.
			if (e.ctrlKey) return
			if (e.deltaY < 0) cancelFollowing()
		}
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
			if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home") cancelFollowing()
		}
		const onPointerDown = () => {
			// Any click on the scroll area may stop following.
			cancelFollowing()
		}

		el.addEventListener("wheel", onWheel, { passive: true })
		el.addEventListener("keydown", onKeyDown)
		el.addEventListener("pointerdown", onPointerDown)
		return () => {
			el.removeEventListener("wheel", onWheel)
			el.removeEventListener("keydown", onKeyDown)
			el.removeEventListener("pointerdown", onPointerDown)
		}
	}, [scrollerEl, cancelFollowing])

	useEffect(() => {
		return () => {
			if (resumeCheckTimerRef.current) {
				clearTimeout(resumeCheckTimerRef.current)
				resumeCheckTimerRef.current = null
			}
		}
	}, [])

	return {
		virtuosoRef,
		scrollContainerRef,
		isFollowing,
		getFollowing,
		cancelFollowing,
		pinToBottom,
		scrollToBottom,
		scrollToMessage,
		toggleRowExpansion,
		isAtBottom,
		pendingScrollToMessage,
		setPendingScrollToMessage,
		scrolledPastUserMessage,
		setScrollerEl,
		handleAtBottomChange,
		handleTotalListHeightChanged,
	}
}
