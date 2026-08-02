import type { ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import type React from "react"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { Virtuoso } from "react-virtuoso"
import { StickyUserMessage } from "@/components/chat/task-header/StickyUserMessage"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { useThinkingLoaderRow } from "../../hooks/useThinkingLoaderRow"
import type { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { findCurrentTurnSummary } from "../../utils/messageUtils"
import { createMessageRenderer } from "../messages/MessageRenderer"

// Sentinel ts for the synthetic "Thinking..." placeholder row. Not a real message; ignored when
// deriving scroll triggers from the tail of the rendered list.
const WAITING_ROW_TS = Number.MIN_SAFE_INTEGER

interface MessagesAreaProps {
	task: ClineMessage
	groupedMessages: (ClineMessage | ClineMessage[])[]
	modifiedMessages: ClineMessage[]
	scrollBehavior: ScrollBehavior
	chatState: ChatState
	messageHandlers: MessageHandlers
}

/**
 * The scrollable messages area with virtualized list
 * Handles rendering of chat rows and browser sessions
 */
export const MessagesArea: React.FC<MessagesAreaProps> = ({
	task,
	groupedMessages,
	modifiedMessages,
	scrollBehavior,
	chatState,
	messageHandlers,
}) => {
	const { clineMessages, turnState } = useExtensionState()
	const lastRawMessage = useMemo(() => clineMessages.at(-1), [clineMessages])

	// Latest-ref so the streaming-phase transition effect can read the current tail
	// without depending on clineMessages (which would re-run it on every append).
	// This render-phase write is safe even under StrictMode: it is an idempotent
	// mirror (each render overwrites with the latest array reference), unlike the
	// transition-tracking refs below that mutate distinct values across renders.
	const clineMessagesRef = useRef(clineMessages)
	clineMessagesRef.current = clineMessages

	const {
		virtuosoRef,
		scrollContainerRef,
		toggleRowExpansion,
		handleRowHeightChange,
		setIsAtBottom,
		disableAutoScrollRef,
		handleRangeChanged,
		scrolledPastUserMessage,
		scrollToMessage,
		scrollToBottomSmooth,
		scrollToBottomAuto,
		handleLastRowContentChange,
	} = scrollBehavior

	// Find the index of the scrolled past user message for scrolling
	const scrolledPastUserMessageIndex = useMemo(() => {
		if (!scrolledPastUserMessage) {
			return -1
		}
		return clineMessages.findIndex((msg) => msg.ts === scrolledPastUserMessage.ts)
	}, [clineMessages, scrolledPastUserMessage])

	// Handler to scroll to the scrolled past user message
	const handleScrollToUserMessage = useCallback(() => {
		if (scrollToMessage && scrolledPastUserMessageIndex >= 0) {
			scrollToMessage(scrolledPastUserMessageIndex)
		}
	}, [scrollToMessage, scrolledPastUserMessageIndex])

	const { expandedRows, inputValue, setActiveQuote } = chatState
	const lastVisibleRow = useMemo(() => groupedMessages.at(-1), [groupedMessages])
	const lastVisibleMessage = useMemo(() => {
		const lastRow = lastVisibleRow
		if (!lastRow) {
			return undefined
		}
		return Array.isArray(lastRow) ? lastRow.at(-1) : lastRow
	}, [lastVisibleRow])

	// Keep loader in the message flow (not footer). Show/hide logic (waiting heuristic,
	// waiting -> reasoning handoff guard, and anti-flash debounce on turn end) lives in the hook.
	const showThinkingLoaderRow = useThinkingLoaderRow({
		turnState,
		lastRawMessage,
		groupedMessages,
		lastVisibleRow,
		lastVisibleMessage,
		modifiedMessages,
	})

	const displayedGroupedMessages = useMemo<(ClineMessage | ClineMessage[])[]>(() => {
		if (!showThinkingLoaderRow) {
			return groupedMessages
		}
		const waitingRow: ClineMessage = {
			ts: WAITING_ROW_TS,
			type: "say",
			say: "reasoning",
			partial: true,
			text: "",
		}
		return [...groupedMessages, waitingRow]
	}, [groupedMessages, showThinkingLoaderRow])

	// useScrollBehavior auto-scrolls when groupedMessages.length changes, but rows can change here
	// without that: the waiting row is turnState-driven (e.g. plan -> act auto-continue adds no
	// message), new tool messages merge into the trailing tool group at constant length, and the
	// waiting row gets swapped for a real reasoning row. Pin to bottom for those too, keyed on the
	// rendered list's length and the tail message's ts (stable across partial updates, so this
	// doesn't fire while a message streams; row growth is handled by ChatRow's height observer).
	const lastTailTs = useMemo(() => {
		for (let i = displayedGroupedMessages.length - 1; i >= 0; i--) {
			const row = displayedGroupedMessages[i]
			const message = Array.isArray(row) ? row.at(-1) : row
			if (message && message.ts !== WAITING_ROW_TS) {
				return message.ts
			}
		}
		return undefined
	}, [displayedGroupedMessages])

	useEffect(() => {
		if (disableAutoScrollRef.current) {
			return
		}
		scrollToBottomSmooth()
		// Settle with an instant scroll so late layout shifts can't leave us short of the bottom.
		// No cleanup: a quick follow-up change would cancel the settle scroll.
		setTimeout(() => {
			if (!disableAutoScrollRef.current) {
				scrollToBottomAuto()
			}
		}, 50)
	}, [displayedGroupedMessages.length, lastTailTs, scrollToBottomSmooth, scrollToBottomAuto, disableAutoScrollRef])

	// Re-engage auto scroll when a new turn starts streaming. A turnState-driven start like
	// plan -> act auto-continue has no webview-side action to reset disableAutoScrollRef, so do
	// it here to keep the "new turn pins to bottom" behavior.
	// NOTE: prevPhaseForStreamingRef is this effect's own ref, not shared with the turn-end effect
	// below. Sharing one ref would let whichever effect runs first overwrite ref.current before the
	// other reads it (effects run in declaration order). Render-phase sharing is no better under
	// StrictMode, so each effect owns its own ref and updates it in its body.
	const prevPhaseForStreamingRef = useRef<TurnPhase | undefined>()
	// Tail ts when streaming began — the turn boundary for findCurrentTurnSummary. Stays undefined
	// for an unobserved turn (reload, opening history), which is harmless: the turn-end effect
	// guards on a preceding streaming phase and never fires then.
	const turnStartTailTsRef = useRef<number | undefined>(undefined)
	useEffect(() => {
		const prevPhase = prevPhaseForStreamingRef.current
		prevPhaseForStreamingRef.current = turnState?.phase
		if (turnState?.phase === "streaming" && prevPhase !== "streaming") {
			turnStartTailTsRef.current = clineMessagesRef.current.at(-1)?.ts
			disableAutoScrollRef.current = false
			scrollToBottomSmooth()
		}
	}, [turnState?.phase, scrollToBottomSmooth, disableAutoScrollRef])

	// Scroll to the top of the turn-final summary message when the turn ends. Only fires if the
	// user hasn't manually scrolled away from the bottom.
	const prevPhaseForSummaryRef = useRef<TurnPhase | undefined>()
	const scrolledSummaryTsRef = useRef<number | null>(null)
	useEffect(() => {
		const phase = turnState?.phase
		const prevPhase = prevPhaseForSummaryRef.current
		prevPhaseForSummaryRef.current = phase
		// Only fire on a real turn end (streaming -> completed/awaiting_followup). An unobserved
		// turn (reload, opening history) lands here without a preceding streaming phase.
		if (phase !== "completed" && phase !== "awaiting_followup") return
		if (prevPhase !== "streaming") return

		// The summary message arrives before the phase flip (partial-message stream fires in
		// appendAndEmit, before setTurnPhase + postStateToWebview), so clineMessages already
		// contains it when this runs. Read from the latest-ref so this effect keys only on the
		// phase transition, not on every message append.
		const messages = clineMessagesRef.current
		const targetIndex = findCurrentTurnSummary(messages, turnStartTailTsRef.current)
		if (targetIndex === -1) return // e.g. switch_to_act_mode produced no summary

		const target = messages[targetIndex]
		if (scrolledSummaryTsRef.current === target.ts) return // already scrolled to this one

		if (disableAutoScrollRef.current) return // user scrolled up; respect their position

		// Suppress the bottom-pinning effect's settle timer so it doesn't yank back to bottom.
		disableAutoScrollRef.current = true
		scrolledSummaryTsRef.current = target.ts
		scrollToMessage(targetIndex)
	}, [turnState?.phase, scrollToMessage, disableAutoScrollRef])

	const itemContent = useMemo(
		() =>
			createMessageRenderer(
				displayedGroupedMessages,
				modifiedMessages,
				expandedRows,
				toggleRowExpansion,
				handleRowHeightChange,
				handleLastRowContentChange,
				setActiveQuote,
				inputValue,
				messageHandlers,
				false,
			),
		[
			displayedGroupedMessages,
			modifiedMessages,
			expandedRows,
			toggleRowExpansion,
			handleRowHeightChange,
			handleLastRowContentChange,
			setActiveQuote,
			inputValue,
			messageHandlers,
		],
	)

	// Keep footer as a simple spacer. Thinking loading is rendered as an in-list row.
	const virtuosoComponents = useMemo(
		() => ({
			Footer: () => <div className="min-h-1" />,
		}),
		[],
	)

	return (
		<div className="overflow-hidden flex flex-col h-full relative">
			{/* Sticky User Message - positioned absolutely to avoid layout shifts */}
			<div
				className={cn(
					"absolute top-0 left-0 right-0 z-10 pl-[15px] pr-[14px] bg-background",
					scrolledPastUserMessage && "pb-2",
				)}>
				<StickyUserMessage
					isVisible={!!scrolledPastUserMessage}
					lastUserMessage={scrolledPastUserMessage}
					onScrollToMessage={handleScrollToUserMessage}
				/>
			</div>

			<div className="grow flex" ref={scrollContainerRef}>
				<Virtuoso
					atBottomStateChange={(isAtBottom) => {
						setIsAtBottom(isAtBottom)
						if (isAtBottom) {
							disableAutoScrollRef.current = false
						}
					}}
					atBottomThreshold={10} // trick to make sure virtuoso re-renders when task changes, and we use initialTopMostItemIndex to start at the bottom
					className="scrollable grow overflow-y-scroll"
					components={virtuosoComponents}
					data={displayedGroupedMessages}
					// increasing top by 3_000 to prevent jumping around when user collapses a row
					increaseViewportBy={{
						top: 3_000,
						bottom: Number.MAX_SAFE_INTEGER,
					}} // hack to make sure the last message is always rendered to get truly perfect scroll to bottom animation when new messages are added (Number.MAX_SAFE_INTEGER is safe for arithmetic operations, which is all virtuoso uses this value for in src/sizeRangeSystem.ts)
					initialTopMostItemIndex={displayedGroupedMessages.length - 1} // messages is the raw format returned by extension, modifiedMessages is the manipulated structure that combines certain messages of related type, and visibleMessages is the filtered structure that removes messages that should not be rendered
					itemContent={itemContent}
					key={task.ts}
					rangeChanged={handleRangeChanged}
					ref={virtuosoRef} // anything lower causes issues with followOutput
					style={{
						scrollbarWidth: "none", // Firefox
						msOverflowStyle: "none", // IE/Edge
						overflowAnchor: "none", // prevent scroll jump when content expands
					}}
				/>
			</div>
		</div>
	)
}
