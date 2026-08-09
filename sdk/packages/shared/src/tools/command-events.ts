/**
 * Lifecycle event payloads for per-command status tracking.
 *
 * Emitted by `executeShellCommands` via `context.emitUpdate` and consumed by
 * the message translator's `content_update` handler for `run_commands`.
 * Each payload carries `commandIndex` to identify which command in a parallel
 * batch the update applies to.
 */

/**
 * Structured payload placed inside `ToolOperationResult.result` for commands
 * executed by `executeShellCommands`. Keeps command-specific metadata out of
 * the generic `ToolOperationResult` interface.
 */
export interface CommandExecutionResult {
	output: string
	exitCode?: number
	/**
	 * Execution outcome. This is a subset of `CommandStateStatus` — it excludes
	 * running, pending, rejected, and unknown, which are UI-only states that the
	 * executor never produces. `rejected` is synthesized by the message
	 * translator when the user denies a command approval.
	 */
	status?: "completed" | "timeout_killed" | "timeout_detached" | "detached" | "cancelled" | "failed"
	timeoutMs?: number
}

export interface CommandStartedUpdate {
	event: "started";
	commandIndex: number;
	startedAt: number;
	timeoutMs: number;
}

export interface CommandCompletedUpdate {
	event: "completed";
	commandIndex: number;
	exitCode: number;
	duration: number;
}

export interface CommandTimeoutUpdate {
	event: "timeout";
	commandIndex: number;
	type: "killed" | "detached";
	duration: number;
}

export interface CommandDetachedUpdate {
	event: "detached";
	commandIndex: number;
	duration: number;
}

export interface CommandCancelledUpdate {
	event: "cancelled";
	commandIndex: number;
	duration: number;
}

export interface CommandFailedUpdate {
	event: "failed";
	commandIndex: number;
	error: string;
	duration: number;
}

export type CommandStatusUpdate =
	| CommandStartedUpdate
	| CommandCompletedUpdate
	| CommandTimeoutUpdate
	| CommandDetachedUpdate
	| CommandCancelledUpdate
	| CommandFailedUpdate;

/**
 * Terminal command statuses (command has finished executing).
 * Shared single source of truth for runtime checks across translator and UI.
 */
export const COMMAND_TERMINAL_STATUSES = [
	"completed",
	"timeout_killed",
	"timeout_detached",
	"detached",
	"cancelled",
	"rejected",
	"failed",
] as const;

/**
 * Statuses that cannot be overwritten by a later "completed" event.
 * Subset of COMMAND_TERMINAL_STATUSES (excludes "completed" itself).
 */
export const PROTECTED_TERMINAL_STATUSES = [
	"timeout_killed",
	"timeout_detached",
	"detached",
	"cancelled",
	"rejected",
	"failed",
] as const;

/**
 * Whether a tool name refers to a command execution tool (run_commands or execute_command).
 */
export function isCommandTool(toolName: string | undefined): boolean {
	return toolName === "run_commands" || toolName === "execute_command";
}
