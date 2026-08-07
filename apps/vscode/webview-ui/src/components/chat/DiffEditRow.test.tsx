import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DiffEditRow } from "./DiffEditRow"

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		openFileRelativePath: vi.fn(),
	},
}))

describe("DiffEditRow", () => {
	it("renders without crashing for a minimal patch", () => {
		const { container } = render(
			<DiffEditRow patch={"------- SEARCH\nold\n=======\nnew\n+++++++ REPLACE"} path="src/foo.ts" />,
		)
		expect(container.textContent).toContain("src/foo.ts")
	})

	// Verifies the parsing/extraction layer: addLinesToPatch + line.slice(2) keep
	// leading whitespace in the extracted code text. The CSS rendering guard
	// (whitespace-pre) is covered by the next test — jsdom does not apply
	// white-space, so textContent alone cannot catch a nowrap regression.
	it("preserves leading whitespace when extracting code from parsed diff lines", () => {
		const patch = [
			"------- SEARCH",
			"    const old = 1", // 4-space indent
			"=======",
			"\t\tconst new = 2", // tab indent
			"+++++++ REPLACE",
		].join("\n")

		render(<DiffEditRow patch={patch} path="src/foo.ts" />)

		const codeSpans = screen.getAllByTestId("diff-code")

		const additionText = codeSpans.find((s) => s.textContent?.includes("const new = 2"))
		expect(additionText?.textContent).toBe("\t\tconst new = 2")

		const deletionText = codeSpans.find((s) => s.textContent?.includes("const old = 1"))
		expect(deletionText?.textContent).toBe("    const old = 1")
	})

	it("uses whitespace-preserving CSS on the code content span", () => {
		const patch = ["------- SEARCH", "    const old = 1", "=======", "        const new = 2", "+++++++ REPLACE"].join("\n")

		render(<DiffEditRow patch={patch} path="src/foo.ts" />)

		const codeSpan = screen.getAllByTestId("diff-code")[0]
		expect(codeSpan?.className).toContain("whitespace-pre")
		expect(codeSpan?.className).not.toContain("whitespace-nowrap")
	})

	it("renders a fallback space for empty lines so rows keep their height", () => {
		// REPLACE block contains an empty line between "bar" and "baz"
		const patch = ["------- SEARCH", "foo", "=======", "bar", "", "baz", "+++++++ REPLACE"].join("\n")

		render(<DiffEditRow patch={patch} path="src/foo.ts" />)

		const codeSpans = screen.getAllByTestId("diff-code")
		const textContents = codeSpans.map((s) => s.textContent)

		// No code span should have empty text content (empty lines fall back to " ")
		expect(textContents.every((t) => t !== "")).toBe(true)
		// The empty line renders as a single space
		expect(textContents).toContain(" ")
	})
})
