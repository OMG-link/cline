import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/hosts/host-provider", () => ({
	HostProvider: {
		workspace: {
			getDiagnostics: vi.fn(),
			getDiagnosticsForFile: vi.fn(),
		},
	},
}))

vi.mock("@/integrations/diagnostics", () => ({
	diagnosticsToProblemsString: vi.fn(),
}))

import { HostProvider } from "@/hosts/host-provider"
import { diagnosticsToProblemsString } from "@/integrations/diagnostics"
import { DiagnosticSeverity, type FileDiagnostics } from "@/shared/proto/index.cline"
import { createVscodeGetDiagnosticsTool } from "./vscode-get-diagnostics-tool"

const mockGetDiagnostics = vi.mocked(HostProvider.workspace.getDiagnostics)
const mockGetDiagnosticsForFile = vi.mocked(HostProvider.workspace.getDiagnosticsForFile)
const mockDiagnosticsToProblemsString = vi.mocked(diagnosticsToProblemsString)

function makeFileDiagnostics(): FileDiagnostics[] {
	return [
		{
			filePath: "/src/index.ts",
			diagnostics: [
				{
					message: "Type error",
					severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
					range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
				},
			],
		},
	]
}

describe("createVscodeGetDiagnosticsTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("has correct tool definition", () => {
		const tool = createVscodeGetDiagnosticsTool()
		expect(tool.name).toBe("get_diagnostics")
		expect(tool.description).toContain("diagnostics")
		expect(tool.description).toContain("Problems panel")
		expect(tool.inputSchema).toMatchObject({
			type: "object",
			properties: {
				severities: {
					type: "array",
					items: { type: "string", enum: ["error", "warning", "information", "hint"] },
				},
				file_path: { type: "string" },
			},
		})
	})

	it("returns formatted diagnostics string when diagnostics exist", async () => {
		const fileDiagnostics = makeFileDiagnostics()
		mockGetDiagnostics.mockResolvedValue({ fileDiagnostics } as never)
		mockDiagnosticsToProblemsString.mockResolvedValue("src/index.ts\n- [Error] Line 2: Type error")

		const tool = createVscodeGetDiagnosticsTool()
		const result = await tool.execute({}, { agentId: "a", iteration: 1 } as never)

		expect(result).toBe("src/index.ts\n- [Error] Line 2: Type error")
		expect(mockDiagnosticsToProblemsString).toHaveBeenCalledWith(fileDiagnostics, [
			DiagnosticSeverity.DIAGNOSTIC_ERROR,
			DiagnosticSeverity.DIAGNOSTIC_WARNING,
		])
	})

	it('returns "No errors or warnings detected." when no diagnostics exist', async () => {
		mockGetDiagnostics.mockResolvedValue({ fileDiagnostics: [] } as never)

		const tool = createVscodeGetDiagnosticsTool()
		const result = await tool.execute({}, { agentId: "a", iteration: 1 } as never)

		expect(result).toBe("No errors or warnings detected.")
		expect(mockDiagnosticsToProblemsString).not.toHaveBeenCalled()
	})

	it("uses default severities (error + warning) when none specified", async () => {
		mockGetDiagnostics.mockResolvedValue({ fileDiagnostics: makeFileDiagnostics() } as never)
		mockDiagnosticsToProblemsString.mockResolvedValue("formatted output")

		const tool = createVscodeGetDiagnosticsTool()
		await tool.execute({}, { agentId: "a", iteration: 1 } as never)

		expect(mockDiagnosticsToProblemsString).toHaveBeenCalledWith(expect.any(Array), [
			DiagnosticSeverity.DIAGNOSTIC_ERROR,
			DiagnosticSeverity.DIAGNOSTIC_WARNING,
		])
	})

	it("filters by specified severities", async () => {
		mockGetDiagnostics.mockResolvedValue({ fileDiagnostics: makeFileDiagnostics() } as never)
		mockDiagnosticsToProblemsString.mockResolvedValue("formatted output")

		const tool = createVscodeGetDiagnosticsTool()
		await tool.execute({ severities: ["error"] }, { agentId: "a", iteration: 1 } as never)

		expect(mockDiagnosticsToProblemsString).toHaveBeenCalledWith(expect.any(Array), [DiagnosticSeverity.DIAGNOSTIC_ERROR])
	})

	it("filters by multiple specified severities", async () => {
		mockGetDiagnostics.mockResolvedValue({ fileDiagnostics: makeFileDiagnostics() } as never)
		mockDiagnosticsToProblemsString.mockResolvedValue("formatted output")

		const tool = createVscodeGetDiagnosticsTool()
		await tool.execute({ severities: ["error", "hint"] }, { agentId: "a", iteration: 1 } as never)

		expect(mockDiagnosticsToProblemsString).toHaveBeenCalledWith(expect.any(Array), [
			DiagnosticSeverity.DIAGNOSTIC_ERROR,
			DiagnosticSeverity.DIAGNOSTIC_HINT,
		])
	})

	it("returns fallback message when formatting yields empty string", async () => {
		mockGetDiagnostics.mockResolvedValue({ fileDiagnostics: makeFileDiagnostics() } as never)
		mockDiagnosticsToProblemsString.mockResolvedValue("")

		const tool = createVscodeGetDiagnosticsTool()
		const result = await tool.execute({ severities: ["hint"] }, { agentId: "a", iteration: 1 } as never)

		expect(result).toBe("No diagnostics matching the specified severity filters were found.")
	})

	// --- file_path branch tests ---

	it("calls getDiagnosticsForFile when file_path is specified and returns diagnostics", async () => {
		const fileDiagnostics = makeFileDiagnostics()
		mockGetDiagnosticsForFile.mockResolvedValue({ fileDiagnostics } as never)
		mockDiagnosticsToProblemsString.mockResolvedValue("src/index.ts\n- [Error] Line 2: Type error")

		const tool = createVscodeGetDiagnosticsTool()
		const result = await tool.execute({ file_path: "/src/index.ts" }, { agentId: "a", iteration: 1 } as never)

		expect(mockGetDiagnosticsForFile).toHaveBeenCalledWith({
			filePath: "/src/index.ts",
		})
		expect(mockGetDiagnostics).not.toHaveBeenCalled()
		expect(result).toBe("src/index.ts\n- [Error] Line 2: Type error")
	})

	it("returns 'ask the user to open' message when file is not open", async () => {
		mockGetDiagnosticsForFile.mockResolvedValue({ fileDiagnostics: [], fileWasOpen: false } as never)

		const tool = createVscodeGetDiagnosticsTool()
		const result = await tool.execute({ file_path: "/src/closed.ts" }, { agentId: "a", iteration: 1 } as never)

		expect(mockGetDiagnosticsForFile).toHaveBeenCalledWith({
			filePath: "/src/closed.ts",
		})
		expect(mockDiagnosticsToProblemsString).not.toHaveBeenCalled()
		expect(result).toContain("not open")
		expect(result).toContain("ask the user to open")
	})

	it("returns 'no errors' when file is open but has no diagnostics", async () => {
		mockGetDiagnosticsForFile.mockResolvedValue({ fileDiagnostics: [], fileWasOpen: true } as never)

		const tool = createVscodeGetDiagnosticsTool()
		const result = await tool.execute({ file_path: "/src/clean.ts" }, { agentId: "a", iteration: 1 } as never)

		expect(result).toBe("No errors or warnings detected.")
		expect(mockDiagnosticsToProblemsString).not.toHaveBeenCalled()
	})
})
