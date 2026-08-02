import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import {
	canRestoreWorkspaceFromMessage,
	filterVisibleMessages,
	findCurrentTurnSummary,
	groupLowStakesTools,
	isSummaryMessage,
	isToolGroup,
} from "./messageUtils"

const createTextMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "text",
	text,
	ts,
})

const createToolMessage = (ts: number, tool: string): ClineMessage => ({
	type: "say",
	say: "tool",
	text: JSON.stringify({ tool, path: "src/file.ts" }),
	ts,
})

const createReasoningMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "reasoning",
	text,
	ts,
})

const createUserFeedbackMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "user_feedback",
	text,
	ts,
})

const createTaskMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "task",
	text,
	ts,
})

const createAskMessage = (
	ts: number,
	ask: "followup" | "plan_mode_respond",
	options: string[],
	selected?: string,
): ClineMessage => ({
	type: "ask",
	ask,
	text: JSON.stringify(
		ask === "followup" ? { question: "Pick one", options, selected } : { response: "Pick one", options, selected },
	),
	ts,
})

describe("filterVisibleMessages", () => {
	it("hides exact user feedback echoes for selected follow-up options", () => {
		const askMessage = createAskMessage(1, "followup", ["Use this", "Use that"], "Use this")
		const visible = filterVisibleMessages([askMessage, createUserFeedbackMessage(2, "Use this")])

		expect(visible).toEqual([askMessage])
	})

	it("hides exact option echoes when selected has not been persisted on the ask row yet", () => {
		const askMessage = createAskMessage(1, "followup", ["Use this", "Use that"])
		const visible = filterVisibleMessages([askMessage, createUserFeedbackMessage(2, "Use this")])

		expect(visible).toEqual([askMessage])
	})

	it("hides exact user feedback echoes for plan-mode response options", () => {
		const askMessage = createAskMessage(1, "plan_mode_respond", ["Plan it", "Do it"], "Plan it")
		const visible = filterVisibleMessages([askMessage, createUserFeedbackMessage(2, "Plan it")])

		expect(visible).toEqual([askMessage])
	})

	it("keeps custom user feedback that extends a selected option", () => {
		const askMessage = createAskMessage(1, "followup", ["Use this", "Use that"], "Use this")
		const userMessage = createUserFeedbackMessage(2, "Use this: include tests")
		const visible = filterVisibleMessages([askMessage, userMessage])

		expect(visible).toEqual([askMessage, userMessage])
	})

	it("keeps exact option feedback when it includes attachments", () => {
		const askMessage = createAskMessage(1, "followup", ["Use this", "Use that"], "Use this")
		const userMessage: ClineMessage = {
			...createUserFeedbackMessage(2, "Use this"),
			images: ["data:image/png;base64,abc"],
		}
		const visible = filterVisibleMessages([askMessage, userMessage])

		expect(visible).toEqual([askMessage, userMessage])
	})
})

describe("canRestoreWorkspaceFromMessage", () => {
	it("allows restore for user messages that start runs, but not ask answers", () => {
		const messages = [
			createTaskMessage(1, "start"),
			createAskMessage(2, "followup", ["src/index.ts"]),
			createTextMessage(3, "Which file should I inspect?"),
			createUserFeedbackMessage(4, "src/index.ts"),
			createUserFeedbackMessage(5, "next task"),
		]

		expect(canRestoreWorkspaceFromMessage(messages, 1)).toBe(true)
		expect(canRestoreWorkspaceFromMessage(messages, 4)).toBe(false)
		expect(canRestoreWorkspaceFromMessage(messages, 5)).toBe(true)
		expect(canRestoreWorkspaceFromMessage(messages, 999)).toBe(false)
	})
})

describe("groupLowStakesTools", () => {
	it("keeps text that arrives after a low-stakes tool group by finalizing the group first", () => {
		const grouped = groupLowStakesTools([
			createTextMessage(1, "Initial text"),
			createToolMessage(2, "readFile"),
			createTextMessage(3, "Post-tool summary text"),
		])

		expect(grouped).toHaveLength(3)
		expect(grouped[0]).toMatchObject({ type: "say", say: "text", text: "Initial text" })
		expect(isToolGroup(grouped[1])).toBe(true)
		expect(grouped[2]).toMatchObject({ type: "say", say: "text", text: "Post-tool summary text" })
	})

	it("keeps text when no low-stakes tool group is active", () => {
		const grouped = groupLowStakesTools([
			createTextMessage(1, "Initial text"),
			createToolMessage(2, "editedExistingFile"),
			createTextMessage(3, "Follow-up text"),
		])

		expect(grouped).toHaveLength(3)
		expect(grouped[0]).toMatchObject({ type: "say", say: "text", text: "Initial text" })
		expect(grouped[1]).toMatchObject({ type: "say", say: "tool" })
		expect(grouped[2]).toMatchObject({ type: "say", say: "text", text: "Follow-up text" })
	})

	it("keeps standalone reasoning when no low-stakes tool group follows", () => {
		const grouped = groupLowStakesTools([
			createReasoningMessage(1, "Thinking through options"),
			createTextMessage(2, "Answer text"),
		])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "reasoning", text: "Thinking through options" })
		expect(grouped[1]).toMatchObject({ type: "say", say: "text", text: "Answer text" })
	})

	it("keeps standalone reasoning before a non-low-stakes tool", () => {
		const grouped = groupLowStakesTools([
			createReasoningMessage(1, "Thinking through options"),
			createToolMessage(2, "editedExistingFile"),
		])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "reasoning", text: "Thinking through options" })
		expect(grouped[1]).toMatchObject({ type: "say", say: "tool" })
	})

	it("keeps reasoning visible when low-stakes tool group starts immediately after", () => {
		const grouped = groupLowStakesTools([createReasoningMessage(1, "Planning next read"), createToolMessage(2, "readFile")])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "reasoning", text: "Planning next read" })
		expect(isToolGroup(grouped[1])).toBe(true)
	})
})

describe("isSummaryMessage", () => {
	it("identifies plan_mode_respond ask as a summary", () => {
		expect(isSummaryMessage({ type: "ask", ask: "plan_mode_respond", text: "{}", ts: 1 })).toBe(true)
	})

	it("identifies completion_result say as a summary", () => {
		expect(isSummaryMessage({ type: "say", say: "completion_result", text: "Done", ts: 1 })).toBe(true)
	})

	it("identifies completion_result ask as a summary", () => {
		expect(isSummaryMessage({ type: "ask", ask: "completion_result", text: "Done", ts: 1 })).toBe(true)
	})

	it("identifies plan_completion_result say as a summary", () => {
		expect(isSummaryMessage({ type: "say", say: "plan_completion_result", text: "Here is the plan", ts: 1 })).toBe(true)
	})

	it("does not identify followup ask as a summary", () => {
		expect(isSummaryMessage({ type: "ask", ask: "followup", text: "{}", ts: 1 })).toBe(false)
	})

	it("does not identify regular text say as a summary", () => {
		expect(isSummaryMessage({ type: "say", say: "text", text: "hello", ts: 1 })).toBe(false)
	})

	it("does not identify tool say as a summary", () => {
		expect(isSummaryMessage({ type: "say", say: "tool", text: "{}", ts: 1 })).toBe(false)
	})

	it("does not identify reasoning say as a summary", () => {
		expect(isSummaryMessage({ type: "say", say: "reasoning", text: "thinking", ts: 1 })).toBe(false)
	})
})

describe("findCurrentTurnSummary", () => {
	const summary = (ts: number): ClineMessage => ({ type: "say", say: "completion_result", text: "Done", ts })
	const apiReq = (ts: number): ClineMessage => ({ type: "say", say: "api_req_started", text: "{}", ts })
	const text = (ts: number): ClineMessage => ({ type: "say", say: "text", text: "hello", ts })

	it("scans the whole array when no boundary was recorded (unobserved turn)", () => {
		// undefined boundary -> no early termination -> returns the last summary
		expect(findCurrentTurnSummary([text(1), summary(5)], undefined)).toBe(1)
	})

	it("returns -1 when no summary exists and no boundary was recorded", () => {
		expect(findCurrentTurnSummary([text(1), text(2)], undefined)).toBe(-1)
	})

	it("returns -1 for an empty array regardless of boundary", () => {
		expect(findCurrentTurnSummary([], undefined)).toBe(-1)
		expect(findCurrentTurnSummary([], 5)).toBe(-1)
	})

	it("breaks before matching a summary that sits exactly on the turn boundary", () => {
		// The boundary (ts 2) is itself a completion_result left over from the previous
		// turn, and this turn added nothing after it. The scan must stop AT the boundary
		// (checked before the summary test), not match it as this turn's summary.
		const messages = [summary(2), apiReq(3)]
		expect(findCurrentTurnSummary(messages, 2)).toBe(-1)
	})

	it("finds a summary at the tail of the current turn", () => {
		// boundary message is ts 1; this turn added 2 then a summary at 3
		const messages = [text(1), text(2), summary(3)]
		expect(findCurrentTurnSummary(messages, 1)).toBe(2)
	})

	it("skips a trailing bookkeeping message after the summary", () => {
		// The done event can emit a trailing api_req_started after the summary.
		const messages = [text(1), summary(3), apiReq(4)]
		expect(findCurrentTurnSummary(messages, 1)).toBe(1)
	})

	it("does not match a summary from an earlier turn", () => {
		// ts 1 is the boundary; an earlier turn's summary at ts 2 is out of window.
		const messages = [summary(2), text(3), apiReq(4)]
		expect(findCurrentTurnSummary(messages, 3)).toBe(-1)
	})

	it("returns -1 when the current turn produced no summary", () => {
		const messages = [text(1), text(2), apiReq(3)]
		expect(findCurrentTurnSummary(messages, 1)).toBe(-1)
	})

	it("scans unbounded when the boundary ts is absent from the array", () => {
		// A stale boundary (e.g. left over from a previous task that MessagesArea did not
		// remount for) behaves like undefined: the break never matches, so the whole array
		// is scanned and the last summary is returned. Call sites that must not fire on a
		// stale boundary guard on a preceding streaming phase instead of relying on this.
		expect(findCurrentTurnSummary([text(1), summary(5)], 999)).toBe(1)
	})
})
