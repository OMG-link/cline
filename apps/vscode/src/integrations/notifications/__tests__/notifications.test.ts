import { afterEach, describe, expect, it, vi } from "vitest"
import * as notificationsModule from "../index"

function decodePowerShellEncodedCommand(encoded: string): string {
	return Buffer.from(encoded, "base64").toString("utf16le")
}

function createResolvedExecaStub() {
	return vi.fn().mockResolvedValue({} as Record<string, never>)
}

describe("notifications", () => {
	afterEach(() => {
		notificationsModule.setNotificationExecaForTesting(null)
		notificationsModule.setNotificationPlatformForTesting(null)
	})

	it("builds a Windows toast script using single-quoted literals and DOM text assignment", () => {
		const script = notificationsModule.buildWindowsToastNotificationScript({
			subtitle: "Approval Required",
			message: "$(Start-Process calc)",
		})

		expect(script).toContain("$message = '$(Start-Process calc)'")
		expect(script).toContain("$textNodes.Item(1).InnerText = $message")
		expect(script).not.toContain('<text id="2">$(Start-Process calc)</text>')
	})

	it("escapes single quotes for PowerShell single-quoted strings", () => {
		expect(notificationsModule.escapePowerShellSingleQuotedString("don't")).toBe("don''t")
	})

	it("escapes single quotes in Windows subtitle and message assignments", () => {
		const script = notificationsModule.buildWindowsToastNotificationScript({
			subtitle: "don't ask twice",
			message: "it's fine",
		})

		expect(script).toContain("$subtitle = 'don''t ask twice'")
		expect(script).toContain("$message = 'it''s fine'")
	})

	it("passes title and combined subtitle/message to notify-send on Linux", async () => {
		const execaStub = createResolvedExecaStub()
		notificationsModule.setNotificationExecaForTesting(execaStub as never)
		const platformStub = vi.fn().mockReturnValue("linux")
		notificationsModule.setNotificationPlatformForTesting(platformStub as never)

		await notificationsModule.showSystemNotification({ title: "Cline", subtitle: "Approval Required", message: "test" })

		expect(execaStub).toHaveBeenCalledOnce()
		expect(execaStub.mock.calls[0][0]).toBe("notify-send")
		expect(execaStub.mock.calls[0][1]).toEqual(["Cline", "Approval Required\ntest"])
	})

	it("encodes Windows PowerShell notifications before dispatch", async () => {
		const execaStub = createResolvedExecaStub()
		notificationsModule.setNotificationExecaForTesting(execaStub as never)
		const platformStub = vi.fn().mockReturnValue("win32")
		notificationsModule.setNotificationPlatformForTesting(platformStub as never)

		await notificationsModule.showSystemNotification({
			subtitle: "Approval Required",
			message: 'npm`install $(Start-Process calc) "quoted"',
		})

		expect(execaStub).toHaveBeenCalledOnce()
		expect(execaStub.mock.calls[0][0]).toBe("powershell")
		const args = execaStub.mock.calls[0][1] as string[]
		expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"])
		expect(args[3]).toBeTypeOf("string")

		const decodedScript = decodePowerShellEncodedCommand(args[3])
		expect(decodedScript).toContain(`$message = 'npm\`install $(Start-Process calc) "quoted"'`)
		expect(decodedScript).toContain("$textNodes.Item(1).InnerText = $message")
	})

	it("encodes PowerShell commands as UTF-16LE base64", () => {
		const encoded = notificationsModule.encodePowerShellCommand("Write-Host 'hello'")
		expect(decodePowerShellEncodedCommand(encoded)).toBe("Write-Host 'hello'")
	})
})
