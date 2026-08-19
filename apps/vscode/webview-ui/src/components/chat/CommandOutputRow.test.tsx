import { act, render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CommandOutputContent, CommandOutputRow, aggregateDisplayStatus, formatTime } from "./CommandOutputRow"
import type { CommandState } from "@shared/ExtensionMessage"
import type { ReactNode } from "react"

vi.mock("../common/CodeBlock", () => ({
	default: ({ source }: { source: string }) => <pre>{source}</pre>,
}))

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: { children?: ReactNode }) => <button {...props}>{children}</button>,
}))

describe("CommandOutputContent", () => {
	it("notifies when visible output changes", async () => {
		const onOutputChange = vi.fn()
		const { rerender } = render(
			<CommandOutputContent
				isContainerExpanded={true}
				isOutputFullyExpanded={false}
				onOutputChange={onOutputChange}
				onToggle={vi.fn()}
				output="first line"
			/>,
		)

		await waitFor(() => expect(onOutputChange).toHaveBeenCalledTimes(1))

		rerender(
			<CommandOutputContent
				isContainerExpanded={true}
				isOutputFullyExpanded={false}
				onOutputChange={onOutputChange}
				onToggle={vi.fn()}
				output={"first line\nsecond line"}
			/>,
		)

		await waitFor(() => expect(onOutputChange).toHaveBeenCalledTimes(2))
	})

	it("notifies when visible output expansion changes", async () => {
		const onOutputChange = vi.fn()
		const { rerender } = render(
			<CommandOutputContent
				isContainerExpanded={true}
				isOutputFullyExpanded={false}
				onOutputChange={onOutputChange}
				onToggle={vi.fn()}
				output={"1\n2\n3\n4\n5\n6"}
			/>,
		)

		await waitFor(() => expect(onOutputChange).toHaveBeenCalledTimes(1))

		rerender(
			<CommandOutputContent
				isContainerExpanded={true}
				isOutputFullyExpanded={true}
				onOutputChange={onOutputChange}
				onToggle={vi.fn()}
				output={"1\n2\n3\n4\n5\n6"}
			/>,
		)

		await waitFor(() => expect(onOutputChange).toHaveBeenCalledTimes(2))
	})

	it("does not notify while the container is collapsed", async () => {
		const onOutputChange = vi.fn()
		render(
			<CommandOutputContent
				isContainerExpanded={false}
				isOutputFullyExpanded={false}
				onOutputChange={onOutputChange}
				onToggle={vi.fn()}
				output="hidden"
			/>,
		)

		await act(async () => {})
		expect(onOutputChange).not.toHaveBeenCalled()
	})
})

describe("CommandOutputRow timeout display", () => {
	const baseProps = {
		isOutputFullyExpanded: false,
		message: { ts: 1, type: "say" as const, say: "command" as const, text: "echo hi" },
		setIsOutputFullyExpanded: vi.fn(),
	}

	it("shows a static pending timeout without running progress", () => {
		const { container } = render(
			<CommandOutputRow
				{...baseProps}
				commandStates={[{ status: "pending" }]}
				commandTimeoutMs={299000}
			/>,
		)
		const text = container.textContent ?? ""
		expect(text).toContain("Pending")
		expect(text).toContain("4:59")
		expect(text).not.toContain("0:00/4:59")
	})

	it("keeps elapsed/total progress for running commands", () => {
		const { container } = render(
			<CommandOutputRow
				{...baseProps}
				commandStates={[{ status: "running", duration: 1000 }]}
				commandTimeoutMs={299000}
			/>,
		)
		expect(container.textContent).toContain("Running")
		expect(container.textContent).toContain("0:01/4:59")
	})
})

describe("aggregateDisplayStatus", () => {
	const s = (status: CommandState["status"]): CommandState => ({ status })

	it("returns Running when any command is running", () => {
		expect(aggregateDisplayStatus([s("running"), s("completed")])).toEqual({
			label: "Running",
			color: "success",
		})
	})

	it("returns Cancelled when any cancelled and none running", () => {
		expect(aggregateDisplayStatus([s("cancelled"), s("completed")])).toEqual({
			label: "Cancelled",
			color: "description",
		})
	})

	it("returns Unknown when any unknown and none running/cancelled", () => {
		expect(aggregateDisplayStatus([s("unknown"), s("completed")])).toEqual({
			label: "Unknown",
			color: "description",
		})
	})

	it("returns Failed when all terminal and any failed", () => {
		expect(aggregateDisplayStatus([s("failed"), s("completed")])).toEqual({
			label: "Failed",
			color: "error",
		})
	})

	it("returns Timeout(killed) when all terminal and any timeout_killed", () => {
		expect(aggregateDisplayStatus([s("timeout_killed"), s("completed")])).toEqual({
			label: "Timeout(killed)",
			color: "error",
		})
	})

	it("returns Timeout(detached) when all terminal and any timeout_detached", () => {
		expect(aggregateDisplayStatus([s("timeout_detached"), s("completed")])).toEqual({
			label: "Timeout(detached)",
			color: "error",
		})
	})

	it("returns Detached when all terminal and any detached", () => {
		expect(aggregateDisplayStatus([s("detached"), s("completed")])).toEqual({
			label: "Detached",
			color: "description",
		})
	})

	it("returns Completed when all terminal and none of the above", () => {
		expect(aggregateDisplayStatus([s("completed"), s("completed")])).toEqual({
			label: "Completed",
			color: "description",
		})
	})

	it("returns Pending when all pending", () => {
		expect(aggregateDisplayStatus([s("pending"), s("pending")])).toEqual({
			label: "Pending",
			color: "warning",
		})
	})

	it("returns Running as default for mixed non-terminal", () => {
		expect(aggregateDisplayStatus([s("pending"), s("completed")])).toEqual({
			label: "Running",
			color: "success",
		})
	})

	it("prioritizes running over cancelled", () => {
		expect(aggregateDisplayStatus([s("running"), s("cancelled")])).toEqual({
			label: "Running",
			color: "success",
		})
	})

	it("returns Rejected when any rejected and none running", () => {
		expect(aggregateDisplayStatus([s("rejected"), s("completed")])).toEqual({
			label: "Rejected",
			color: "description",
		})
	})

	it("prioritizes running over rejected", () => {
		expect(aggregateDisplayStatus([s("running"), s("rejected")])).toEqual({
			label: "Running",
			color: "success",
		})
	})

	it("prioritizes cancelled over unknown", () => {
		expect(aggregateDisplayStatus([s("cancelled"), s("unknown")])).toEqual({
			label: "Cancelled",
			color: "description",
		})
	})

	it("returns Unknown when mixing unknown with terminal states (unknown is not terminal)", () => {
		// unknown is not in the allTerminal set, so allTerminal is false;
		// has(UNKNOWN) fires unconditionally before the allTerminal-gated branches
		expect(aggregateDisplayStatus([s("unknown"), s("failed")])).toEqual({
			label: "Unknown",
			color: "description",
		})
		expect(aggregateDisplayStatus([s("unknown"), s("timeout_killed")])).toEqual({
			label: "Unknown",
			color: "description",
		})
	})
})

describe("formatTime", () => {
	it.each([
		[299000, "4:59"],
		[300000, "5:00"],
		[1000, "0:01"],
	])("formats %s milliseconds as %s", (timeoutMs, expected) => {
		expect(formatTime(timeoutMs)).toBe(expected)
	})
})
