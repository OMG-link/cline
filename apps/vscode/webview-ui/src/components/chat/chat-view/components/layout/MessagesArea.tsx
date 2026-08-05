import type { ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import type React from "react"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { Virtuoso } from "react-virtuoso"
import ChatRow from "@/components/chat/ChatRow"
import { StickyUserMessage } from "@/components/chat/task-header/StickyUserMessage"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { useThinkingLoaderRow } from "../../hooks/useThinkingLoaderRow"
import type { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { isPendingResponseUnconfirmed } from "../../utils/pendingResponse"
import { findCurrentTurnSummary } from "../../utils/messageUtils"
import { createMessageRenderer } from "../messages/MessageRenderer"

// Sentinel ts for the synthetic "Thinking..." placeholder row. Not a real message.
const WAITING_ROW_TS = Number.MIN_SAFE_INTEGER

// Synthetic placeholder rendered while waiting for the model with no visible rows streaming.
const WAITING_ROW: ClineMessage = {
	ts: WAITING_ROW_TS,
	type: "say",
	say: "reasoning",
	partial: true,
	text: "",
}

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
		enableAutoScrollRef,
		cancelFollowing,
		scrolledPastUserMessage,
		scrollToMessage,
		scrollToBottom,
		setScrollerEl,
		handleAtBottomChange,
		handleTotalListHeightChanged,
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
	// A turn (new task or follow-up) was just started from this webview but the backend's
	// streaming TurnState has not round-tripped yet, so the replica's turnState is stale
	// (idle/completed/awaiting_*). Let the loader show optimistically so "Thinking..." renders
	// the moment the send happens instead of popping in after the state post.
	const forcePendingResponseLoader = isPendingResponseUnconfirmed(chatState.pendingResponse, turnState, clineMessages.length)

	// Keep loader in the message flow (not footer). Show/hide logic (waiting heuristic,
	// waiting -> reasoning handoff guard, and anti-flash debounce on turn end) lives in the hook.
	const showThinkingLoaderRow = useThinkingLoaderRow({
		turnState,
		lastRawMessage,
		groupedMessages,
		lastVisibleRow,
		lastVisibleMessage,
		modifiedMessages,
		forceShow: forcePendingResponseLoader,
	})

	// While the list has no visible rows yet (new task just submitted), the loader is rendered as
	// a plain element instead of a Virtuoso item: a cold-mounting virtualized list takes several
	// frames to measure and paint its first item, which visibly delays the "Thinking..." shimmer
	// right when the chat view appears. Once any real row exists the list is warm and the loader
	// goes back to being an in-list row (unchanged behavior).
	const showEmptyListLoader = showThinkingLoaderRow && groupedMessages.length === 0

	const displayedGroupedMessages = useMemo<(ClineMessage | ClineMessage[])[]>(() => {
		if (!showThinkingLoaderRow || showEmptyListLoader) {
			return groupedMessages
		}
		return [...groupedMessages, WAITING_ROW]
	}, [groupedMessages, showThinkingLoaderRow, showEmptyListLoader])

	// Re-engage following when a new turn starts streaming. A turnState-driven start like
	// plan -> act auto-continue has no webview-side action to re-enable following, so do
	// it here (via scrollToBottom, which re-enables following and scrolls to bottom).
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
			scrollToBottom(true)
		}
	}, [turnState?.phase, scrollToBottom])

	// Scroll to the top of the turn-final summary message when the turn ends. Only fires if the
	// user hasn't cancelled following.
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

		if (!enableAutoScrollRef.current) return // user scrolled up; respect their position

		// Suppress the pin while scrolling to the summary, so it can't fight the
		// navigation. cancelFollowing arms the fixed cancel lock, which also blocks
		// tryResumeFollow from re-enabling during the scroll.
		cancelFollowing()
		scrolledSummaryTsRef.current = target.ts
		scrollToMessage(targetIndex)
	}, [turnState?.phase, enableAutoScrollRef, cancelFollowing, scrollToMessage])

	const itemContent = useMemo(
		() =>
			createMessageRenderer(
				displayedGroupedMessages,
				modifiedMessages,
				expandedRows,
				toggleRowExpansion,
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

			<div className="grow flex relative" ref={scrollContainerRef}>
				{/* Empty-list fast path: paint the loader immediately without waiting for the
				    virtualized list's initial measure/render cycle. Mirrors the in-list row's
				    markup (MessageRenderer wrapper + ChatRow) so the swap to a real row later
				    causes no visual jump. Virtuoso stays mounted (empty) underneath, so it is
				    already warm when the first real row arrives. */}
				{showEmptyListLoader && (
					<div className="absolute inset-0 overflow-hidden">
						<ChatRow
							inputValue={inputValue}
							isExpanded={false}
							isLast={true}
							lastModifiedMessage={modifiedMessages.at(-1)}
							message={WAITING_ROW}
							onCancelCommand={() => messageHandlers.executeButtonAction("cancel")}
							onHeightChange={handleRowHeightChange}
							onLastRowContentChange={handleLastRowContentChange}
							onSetQuote={setActiveQuote}
							onToggleExpand={toggleRowExpansion}
							sendMessageFromChatRow={messageHandlers.handleSendMessage}
						/>
					</div>
				)}
				<Virtuoso
					atBottomStateChange={handleAtBottomChange}
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
					ref={virtuosoRef}
					scrollerRef={(ref) => setScrollerEl(ref instanceof HTMLElement ? ref : null)}
					style={{
						scrollbarWidth: "none", // Firefox
						msOverflowStyle: "none", // IE/Edge
						overflowAnchor: "none", // prevent scroll jump when content expands
					}}
					totalListHeightChanged={handleTotalListHeightChanged}
				/>
			</div>
		</div>
	)
}
