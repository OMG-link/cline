/**
 * VS Code-specific `get_diagnostics` tool.
 *
 * Allows the agent to read VS Code's diagnostics (the Problems panel) on
 * demand — syntax errors, type errors, warnings, etc. — across the workspace.
 * This is an IDE-level feature built on top of the SDK, NOT part of the SDK.
 */

import { createTool } from "@cline/shared"
import type { AgentTool } from "@cline/shared"
import { HostProvider } from "@/hosts/host-provider"
import { diagnosticsToProblemsString } from "@/integrations/diagnostics"
import { DiagnosticSeverity, type FileDiagnostics } from "@/shared/proto/index.cline"

const SEVERITY_MAP: Record<string, DiagnosticSeverity> = {
	error: DiagnosticSeverity.DIAGNOSTIC_ERROR,
	warning: DiagnosticSeverity.DIAGNOSTIC_WARNING,
	information: DiagnosticSeverity.DIAGNOSTIC_INFORMATION,
	hint: DiagnosticSeverity.DIAGNOSTIC_HINT,
}

const inputSchema = {
	type: "object",
	properties: {
		severities: {
			type: "array",
			items: {
				type: "string",
				enum: ["error", "warning", "information", "hint"],
			},
			description: 'Filter by severity levels. Defaults to ["error", "warning"].',
		},
		file_path: {
			type: "string",
			description:
				"Absolute path to a file to get diagnostics for. " +
				"The file must be currently open and visible in the editor. " +
				"If the file is not open, this tool cannot obtain its " +
				"diagnostics - ask the user to open it. When omitted, " +
				"diagnostics for all currently open files are returned.",
		},
	},
}

/**
 * Creates the `get_diagnostics` tool for the VS Code extension.
 *
 * Without `file_path`: returns diagnostics for all open files (same data
 * source as the `@problems` mention).
 *
 * With `file_path`: returns diagnostics for that specific file. The
 * file must already be open in the editor; if not, the tool tells the
 * agent to open it first.
 */
export function createVscodeGetDiagnosticsTool(): AgentTool {
	return createTool({
		name: "get_diagnostics",
		description:
			"Read VS Code's diagnostics (the Problems panel) to get current syntax errors, " +
			"type errors, warnings, and other issues. " +
			"Only reports diagnostics for files that are currently open in the editor. " +
			"If file_path is specified for a file that is not open, the tool will tell " +
			"you to open it first. " +
			"Use this after making edits to verify no errors were introduced, " +
			"or to understand existing issues before making changes. " +
			"Returns a formatted list of diagnostics grouped by file.",
		inputSchema,
		execute: async (input) => {
			const requestedSeverities = (input as { severities?: string[] }).severities
			const severities =
				requestedSeverities && requestedSeverities.length > 0
					? requestedSeverities.map((s) => SEVERITY_MAP[s]).filter((s): s is DiagnosticSeverity => s !== undefined)
					: [DiagnosticSeverity.DIAGNOSTIC_ERROR, DiagnosticSeverity.DIAGNOSTIC_WARNING]

			const filePath = (input as { file_path?: string }).file_path

			let fileDiagnostics: FileDiagnostics[]

			if (filePath) {
				const response = await HostProvider.workspace.getDiagnosticsForFile({
					filePath,
				})
				fileDiagnostics = response.fileDiagnostics

				if (fileDiagnostics.length === 0) {
					return response.fileWasOpen
						? "No errors or warnings detected."
						: `File "${filePath}" is not open in the editor. Diagnostics are only available for files that are currently open and visible. Please ask the user to open this file, then call get_diagnostics again.`
				}
			} else {
				const response = await HostProvider.workspace.getDiagnostics({})
				fileDiagnostics = response.fileDiagnostics

				if (fileDiagnostics.length === 0) {
					return "No errors or warnings detected."
				}
			}

			const diagnosticsString = await diagnosticsToProblemsString(fileDiagnostics, severities)

			return diagnosticsString || "No diagnostics matching the specified severity filters were found."
		},
	})
}
