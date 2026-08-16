/**
 * Shared types and interfaces for the chat view components
 */

import { ClineAsk, ClineMessage } from "@shared/ExtensionMessage"
import { VirtuosoHandle } from "react-virtuoso"
import { ButtonActionType } from "../shared/buttonConfig"

export interface PendingUserMessage {
	message: ClineMessage
	afterTs: number
}

export interface PendingResponse {
	/** Locally unique submission id, used to avoid an older RPC clearing newer state. */
	id: number
	/** TurnState sequence observed when the RPC was sent. */
	turnStateSeq: number | undefined
	/** Raw backend message count observed when the RPC was sent (legacy fallback). */
	messageCount: number
}

/**
 * Chat state interface
 */
export interface ChatState {
	// State values
	inputValue: string
	setInputValue: React.Dispatch<React.SetStateAction<string>>
	activeQuote: string | null
	setActiveQuote: React.Dispatch<React.SetStateAction<string | null>>
	isTextAreaFocused: boolean
	setIsTextAreaFocused: React.Dispatch<React.SetStateAction<boolean>>
	selectedImages: string[]
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	selectedFiles: string[]
	setSelectedFiles: React.Dispatch<React.SetStateAction<string[]>>
	sendingDisabled: boolean
	setSendingDisabled: React.Dispatch<React.SetStateAction<boolean>>
	enableButtons: boolean
	setEnableButtons: React.Dispatch<React.SetStateAction<boolean>>
	primaryButtonText: string | undefined
	setPrimaryButtonText: React.Dispatch<React.SetStateAction<string | undefined>>
	secondaryButtonText: string | undefined
	setSecondaryButtonText: React.Dispatch<React.SetStateAction<string | undefined>>
	expandedRows: Record<number, boolean>
	setExpandedRows: React.Dispatch<React.SetStateAction<Record<number, boolean>>>
	pendingUserMessage: PendingUserMessage | undefined
	setPendingUserMessage: React.Dispatch<React.SetStateAction<PendingUserMessage | undefined>>
	pendingResponse: PendingResponse | undefined
	setPendingResponse: React.Dispatch<React.SetStateAction<PendingResponse | undefined>>

	// Refs
	textAreaRef: React.RefObject<HTMLTextAreaElement>

	// Derived values
	lastMessage: ClineMessage | undefined
	secondLastMessage: ClineMessage | undefined
	clineAsk: ClineAsk | undefined
	task: ClineMessage | undefined

	// Handlers
	handleFocusChange: (isFocused: boolean) => void
	clearExpandedRows: () => void
	resetState: () => void
}

/**
 * Message handlers interface
 */
export interface MessageHandlers {
	executeButtonAction: (action: ButtonActionType, text?: string, images?: string[], files?: string[]) => Promise<void>
	handleSendMessage: (text: string, images: string[], files: string[]) => Promise<void>
	handleTaskCloseButtonClick: () => void
	startNewTask: () => Promise<void>
}

/**
 * Scroll behavior interface
 */
export interface ScrollBehavior {
	virtuosoRef: React.RefObject<VirtuosoHandle>
	scrollContainerRef: React.RefObject<HTMLDivElement>
	// Whether the viewport is actively following new content (UI binding).
	isFollowing: boolean
	// Imperative read of following state for async callbacks (rAF, setTimeout,
	// event listeners) where a state snapshot would be stale.
	getFollowing: () => boolean
	// Cancels following and arms the fixed cancel-follow lock.
	cancelFollowing: (reason?: string) => void
	// Re-enables following (clears the cancel lock) and scrolls to the bottom.
	scrollToBottom: (smooth?: boolean, reason?: string) => void
	// Following-gated scroll to the bottom; does not change following.
	pinToBottom: (reason?: string) => void
	scrollToMessage: (messageIndex: number, reason?: string) => void
	toggleRowExpansion: (ts: number, options?: { preserveAutoScroll?: boolean }) => void
	isAtBottom: boolean
	pendingScrollToMessage: number | null
	setPendingScrollToMessage: React.Dispatch<React.SetStateAction<number | null>>
	scrolledPastUserMessage: ClineMessage | null
	// The Virtuoso scroller element setter, captured via the scrollerRef prop.
	setScrollerEl: (el: HTMLElement | null) => void
	// Handler for Virtuoso's atBottomStateChange prop.
	handleAtBottomChange: (atBottom: boolean) => void
	// Handler for Virtuoso's totalListHeightChanged prop (streaming follow).
	handleTotalListHeightChanged: () => void
}

/**
 * Welcome section props
 */
export interface WelcomeSectionProps {
	showAnnouncement: boolean
	hideAnnouncement: () => void
	showHistoryView: () => void
	telemetrySetting: string
	version: string
	taskHistory: any[]
	shouldShowQuickWins: boolean
}
