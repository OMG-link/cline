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
import { DiagnosticSeverity } from "@/shared/proto/index.cline"

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
	},
}

/**
 * Creates the `get_diagnostics` tool for the VS Code extension.
 *
 * The tool calls `HostProvider.workspace.getDiagnostics()` (backed by
 * `vscode.languages.getDiagnostics()`) and formats the result via
 * `diagnosticsToProblemsString()`, the same utility used by the `@problems`
 * mention.
 */
export function createVscodeGetDiagnosticsTool(): AgentTool {
	return createTool({
		name: "get_diagnostics",
		description:
			"Read VS Code's diagnostics (the Problems panel) to get current syntax errors, " +
			"type errors, warnings, and other issues. " +
			"Only reports diagnostics for files that are currently open in the editor; " +
			"unopened files are not analyzed. " +
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

			const response = await HostProvider.workspace.getDiagnostics({})

			if (response.fileDiagnostics.length === 0) {
				return "No errors or warnings detected."
			}

			const diagnosticsString = await diagnosticsToProblemsString(response.fileDiagnostics, severities)

			return diagnosticsString || "No diagnostics matching the specified severity filters were found."
		},
	})
}
