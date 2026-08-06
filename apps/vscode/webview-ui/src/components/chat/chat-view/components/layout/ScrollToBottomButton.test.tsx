import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ScrollToBottomButton } from "./ScrollToBottomButton"

describe("ScrollToBottomButton", () => {
	it("renders with accessible name", () => {
		render(<ScrollToBottomButton onClick={vi.fn()} />)
		expect(screen.getByRole("button", { name: "Scroll to bottom" })).toBeTruthy()
	})

	it("calls onClick when clicked", async () => {
		const user = userEvent.setup()
		const onClick = vi.fn()
		render(<ScrollToBottomButton onClick={onClick} />)
		await user.click(screen.getByRole("button", { name: "Scroll to bottom" }))
		expect(onClick).toHaveBeenCalled()
	})
})
