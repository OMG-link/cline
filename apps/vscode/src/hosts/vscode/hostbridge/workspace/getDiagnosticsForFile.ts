import * as vscode from "vscode"
import { GetDiagnosticsForFileRequest, GetDiagnosticsForFileResponse } from "@/shared/proto/host/workspace"
import { convertToFileDiagnostics } from "./getDiagnostics"

export async function getDiagnosticsForFile(request: GetDiagnosticsForFileRequest): Promise<GetDiagnosticsForFileResponse> {
	const filePath = request.filePath?.trim()
	if (!filePath) {
		throw new Error("file_path is required")
	}

	const uri = vscode.Uri.file(filePath)

	const alreadyOpen = vscode.workspace.textDocuments.some((doc) => doc.uri.toString() === uri.toString())

	if (alreadyOpen) {
		const diagnostics = vscode.languages.getDiagnostics(uri)
		return {
			fileDiagnostics: diagnostics.length > 0 ? convertToFileDiagnostics([[uri, diagnostics]]) : [],
			fileWasOpen: true,
		}
	}

	return { fileDiagnostics: [], fileWasOpen: false }
}
