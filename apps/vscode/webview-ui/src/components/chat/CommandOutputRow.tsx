import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { ClineMessage, COMMAND_STATUS, CommandState, CommandStateStatus } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { memo, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"
import CodeBlock from "../common/CodeBlock"
import ExpandHandle from "./ExpandHandle"

export const CommandOutputContent = memo(
	({
		output,
		isOutputFullyExpanded,
		onToggle,
		isContainerExpanded,
		onOutputChange,
	}: {
		output: string
		isOutputFullyExpanded: boolean
		onToggle: () => void
		isContainerExpanded: boolean
		onOutputChange?: () => void
	}) => {
		const outputLines = output.split("\n")
		const lineCount = outputLines.length
		const shouldAutoShow = lineCount <= 5
		const outputRef = useRef<HTMLDivElement>(null)

		// Auto-scroll to bottom when output changes (only when showing limited output)
		useEffect(() => {
			if (!isOutputFullyExpanded && outputRef.current) {
				// Direct scrollTop manipulation
				outputRef.current.scrollTop = outputRef.current.scrollHeight

				// Another attempt with more delay (for slower renders) to ensure scrolling works
				setTimeout(() => {
					if (outputRef.current) {
						outputRef.current.scrollTop = outputRef.current.scrollHeight
					}
				}, 50)
			}
		}, [output, isOutputFullyExpanded])

		useEffect(() => {
			if (isContainerExpanded) {
				onOutputChange?.()
			}
		}, [output, isOutputFullyExpanded, isContainerExpanded, onOutputChange])

		// Don't render anything if container is collapsed
		if (!isContainerExpanded) {
			return null
		}

		// Check if output contains a log file path indicator
		const logFilePathMatch = output.match(/📋 Output is being logged to: ([^\n]+)/)
		const logFilePath = logFilePathMatch ? logFilePathMatch[1].trim() : null

		// Render output with clickable log file path
		const renderOutput = () => {
			if (!logFilePath) {
				return <CodeBlock forceWrap={true} source={`${"```"}shell\n${output}\n${"```"}`} />
			}

			// Split output into parts: before log path, log path line, after log path
			const logPathLineStart = output.indexOf("📋 Output is being logged to:")
			const logPathLineEnd = output.indexOf("\n", logPathLineStart)
			const beforeLogPath = output.substring(0, logPathLineStart)
			const afterLogPath = logPathLineEnd !== -1 ? output.substring(logPathLineEnd) : ""

			// Extract just the filename from the full path for display
			const fileName = logFilePath.split("/").pop() || logFilePath

			return (
				<div className="border border-editor-group-border rounded-sm">
					{beforeLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${beforeLogPath}\n${"```"}`} />}
					<div
						className="flex flex-wrap items-center gap-1.5 px-3 py-2 mx-2 my-1.5 rounded-sm bg-banner-background cursor-pointer hover:brightness-110 transition-colors"
						onClick={() => {
							FileServiceClient.openFile(StringRequest.create({ value: logFilePath })).catch((err) =>
								console.error("Failed to open log file:", err),
							)
						}}
						title={`Click to open: ${logFilePath}`}>
						<span className="shrink-0">📋 Output is being logged to:</span>
						<span className="text-vscode-textLink-foreground underline break-all">{fileName}</span>
					</div>
					{afterLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${afterLogPath}\n${"```"}`} />}
				</div>
			)
		}

		return (
			<div
				className={cn("w-full relative pb-0 overflow-visible border-t border-editor-group-border bg-code rounded-sm", {
					"rounded-b-none": lineCount > 5,
				})}>
				<div
					className={cn("text-white scroll-smooth bg-code overflow-y-auto", {
						"max-h-[75px]": !shouldAutoShow && !isOutputFullyExpanded,
						"max-h-[200px]": !shouldAutoShow && isOutputFullyExpanded,
						"overflow-y-visible": shouldAutoShow,
					})}
					ref={outputRef}>
					<div className="bg-code">{renderOutput()}</div>
				</div>
				{/* Show notch only if there's more than 5 lines */}
				{lineCount > 5 && <ExpandHandle isExpanded={isOutputFullyExpanded} onToggle={onToggle} />}
			</div>
		)
	},
)

CommandOutputContent.displayName = "CommandOutputContent"

export const CommandOutputRow = memo(
	({
		message,
		isBackgroundExec = false, // vscodeTerminalExecutionMode === "backgroundExec"
		onCancelCommand,
		icon,
		title,
		isOutputFullyExpanded,
		setIsOutputFullyExpanded,
		onOutputChange,
		commandStates,
		commandTimeoutMs,
		legacyCommandCompleted = false,
	}: {
		message: ClineMessage
		isBackgroundExec?: boolean
		onCancelCommand?: () => void
		icon?: JSX.Element | null
		title?: JSX.Element | null
		isOutputFullyExpanded: boolean
		setIsOutputFullyExpanded: (expanded: boolean) => void
		onOutputChange?: () => void
		commandStates?: CommandState[]
		commandTimeoutMs?: number
		legacyCommandCompleted?: boolean
	}) => {
		const splitMessage = (text: string) => {
			const outputIndex = text.indexOf(COMMAND_OUTPUT_STRING)
			if (outputIndex === -1) {
				return { command: text, output: "" }
			}
			return {
				command: text.slice(0, outputIndex).trim(),
				output: text
					.slice(outputIndex + COMMAND_OUTPUT_STRING.length)
					.trim()
					.split("")
					.map((char) => {
						switch (char) {
							case "\t":
								return "→   "
							case "\b":
								return "⌫"
							case "\f":
								return "⏏"
							case "\v":
								return "⇳"
							default:
								return char
						}
					})
					.join(""),
			}
		}

		const { command: rawCommand, output } = splitMessage(message.text || "")

		const requestsApproval = rawCommand.endsWith(COMMAND_REQ_APP_STRING)
		const command = requestsApproval ? rawCommand.slice(0, -COMMAND_REQ_APP_STRING.length) : rawCommand

		const displayStatus = commandStates?.length
			? aggregateDisplayStatus(commandStates)
			: legacyCommandCompleted
				? { label: "Completed", color: "description" }
				: { label: "Running", color: "success" }

		const anyRunning = commandStates?.some((cs) => cs.status === COMMAND_STATUS.RUNNING) ?? false
		const firstStartedAt = commandStates?.find((cs) => cs.startedAt)?.startedAt
		const [elapsedMs, setElapsedMs] = useState(0)

		useEffect(() => {
			if (!anyRunning || !firstStartedAt) return
			const update = () => setElapsedMs(Date.now() - firstStartedAt)
			update()
			const interval = setInterval(update, 1000)
			return () => clearInterval(interval)
		}, [anyRunning, firstStartedAt])

		const isOvertime = anyRunning && commandTimeoutMs != null && elapsedMs >= commandTimeoutMs
		// Display duration: take the longest running time among parallel commands,
		// monotonically non-decreasing. Terminal commands use backend duration;
		// still-running commands use real-time elapsed (Date.now() - startedAt),
		// so that partially completed commands still reflect the progress of remaining running commands without freezing.
		const candidateDurations =
			commandStates?.map((cs) => {
				if (cs.duration != null) return cs.duration
				if (cs.status === COMMAND_STATUS.RUNNING && cs.startedAt != null) return Date.now() - cs.startedAt
				return 0
			}) ?? []
		const displayDurationMs = candidateDurations.length > 0 ? Math.max(...candidateDurations) : elapsedMs
		// Frontend local timeout detection: still showing running but over budget
		// -> display as Timeout (no suffix), then switch to Timeout(killed)/Timeout(detached)
		const effectiveDisplayStatus = isOvertime
			? { label: "Timeout", color: "error" }
			: displayStatus
		const isPending = commandStates?.length
			? commandStates.every((cs) => cs.status === COMMAND_STATUS.PENDING)
			: effectiveDisplayStatus.label === "Pending"
		const pendingTimeoutText = isPending && commandTimeoutMs !== undefined ? formatTime(commandTimeoutMs) : undefined
		const showPendingTimeout = pendingTimeoutText !== undefined
		const showProgress = !isPending && commandTimeoutMs !== undefined
		const showCancelButton =
			(anyRunning || commandStates?.some((cs) => cs.status === COMMAND_STATUS.PENDING)) &&
			typeof onCancelCommand === "function" &&
			isBackgroundExec

		const commandHeader = (
			<div className="flex items-center gap-2.5 mb-3">
				{icon}
				{title}
			</div>
		)

		return (
			<>
				{commandHeader}
				<div
					className="bg-code rounded-sm border border-editor-group-border"
					style={{
						transition: "all 0.3s ease-in-out",
					}}>
					{command && (
						<div className="bg-code flex items-center justify-between px-2 py-2.5 border-b border-editor-group-border rounded-sm rounded-b-none overflow-hidden">
							<div className="flex items-center gap-2 flex-1 m-w-0">
								<div
									className={cn("bg-description rounded-full w-2 h-2 shrink-0", {
										"bg-success animate-pulse": effectiveDisplayStatus.color === "success",
										"bg-editor-warning-foreground": effectiveDisplayStatus.color === "warning",
										"bg-error": effectiveDisplayStatus.color === "error",
									})}
								/>
								<span
									className={cn("text-description font-medium text-base shrink-0", {
										"text-success": effectiveDisplayStatus.color === "success",
										"text-editor-warning-foreground": effectiveDisplayStatus.color === "warning",
										"text-error": effectiveDisplayStatus.color === "error",
									})}>
									{effectiveDisplayStatus.label}
					{showPendingTimeout && (
						<span className="text-description ml-1">{pendingTimeoutText}</span>
									)}
									{showProgress && (
										<span className="text-description ml-1">
											{formatTime(displayDurationMs)}/{formatTime(commandTimeoutMs)}
										</span>
									)}
								</span>
							</div>
							<div className="flex items-center gap-2 shrink-0">
								{showCancelButton && (
									<Button
										onClick={(e) => {
											e.stopPropagation()
											if (isBackgroundExec) {
												onCancelCommand?.()
											} else {
												// For regular terminal mode, show a message
												alert(
													"This command is running in the VSCode terminal. You can manually stop it using Ctrl+C in the terminal, or switch to Background Execution mode in settings for cancellable commands.",
												)
											}
										}}
										size="xs"
										variant="secondary">
										{isBackgroundExec ? "cancel" : "stop"}
									</Button>
								)}
							</div>
						</div>
					)}

					<div className="bg-code opacity-60 text-sm">
						<CodeBlock forceWrap={true} source={`${"```"}shell\n${command}\n${"```"}`} />
					</div>

					{output.length > 0 && (
						<CommandOutputContent
							isContainerExpanded={true}
							isOutputFullyExpanded={isOutputFullyExpanded}
							onToggle={() => setIsOutputFullyExpanded(!isOutputFullyExpanded)}
							onOutputChange={onOutputChange}
							output={output}
						/>
					)}
				</div>
				{requestsApproval && (
					<div className="flex items-center gap-2.5 p-2 text-[12px] text-editor-warning-foreground">
						<i className="codicon codicon-warning" />
						<span>The model has determined this command requires explicit approval.</span>
					</div>
				)}
			</>
		)
	},
)

CommandOutputRow.displayName = "CommandOutputRow"

interface DisplayStatus {
	label: string
	color: "success" | "warning" | "error" | "description"
}

/**
 * Aggregate per-command states into a single status label for the one-row UI.
 *
 * The status bar renders a single label per command row; per-command states
 * are preserved in `commandStates` for a future expanded-view chip layout.
 *
 * Priority (high -> low):
 *   running > rejected > cancelled > unknown > failed > [timeout_killed, timeout_detached, detached] > completed > pending
 *
 * Note: the failed / timeout / completed branches are gated by `allTerminal`
 * (every command in the batch has reached a terminal state). The earlier
 * branches (running, rejected, cancelled, unknown) fire unconditionally
 * regardless of whether other commands are still non-terminal. This means
 * a batch like [unknown, failed] returns "Unknown", not "Failed", because
 * the `has(UNKNOWN)` check precedes the `allTerminal && has(FAILED)` check.
 *
 * cancelled is excluded from allTerminal because it is a user-intent state,
 * not an execution outcome. A batch mixing cancelled + failed shows
 * "Cancelled" (user chose to abort, results are irrelevant).
 */
export function aggregateDisplayStatus(states: CommandState[]): DisplayStatus {
	const has = (s: CommandStateStatus) => states.some((cs) => cs.status === s)
	const allTerminal = states.every((cs) =>
		([COMMAND_STATUS.COMPLETED, COMMAND_STATUS.TIMEOUT_KILLED, COMMAND_STATUS.TIMEOUT_DETACHED, COMMAND_STATUS.DETACHED, COMMAND_STATUS.REJECTED, COMMAND_STATUS.FAILED] as CommandStateStatus[]).includes(cs.status),
	)

	if (has(COMMAND_STATUS.RUNNING)) return { label: "Running", color: "success" }
	if (has(COMMAND_STATUS.REJECTED)) return { label: "Rejected", color: "description" }
	if (has(COMMAND_STATUS.CANCELLED)) return { label: "Cancelled", color: "description" }
	if (has(COMMAND_STATUS.UNKNOWN)) return { label: "Unknown", color: "description" }
	if (allTerminal && has(COMMAND_STATUS.FAILED)) return { label: "Failed", color: "error" }
	if (allTerminal && has(COMMAND_STATUS.TIMEOUT_KILLED)) return { label: "Timeout(killed)", color: "error" }
	if (allTerminal && has(COMMAND_STATUS.TIMEOUT_DETACHED)) return { label: "Timeout(detached)", color: "error" }
	if (allTerminal && has(COMMAND_STATUS.DETACHED)) return { label: "Detached", color: "description" }
	if (allTerminal) return { label: "Completed", color: "description" }
	if (states.every((cs) => cs.status === COMMAND_STATUS.PENDING)) return { label: "Pending", color: "warning" }
	return { label: "Running", color: "success" }
}

export function formatTime(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000)
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	return `${minutes}:${seconds.toString().padStart(2, "0")}`
}
