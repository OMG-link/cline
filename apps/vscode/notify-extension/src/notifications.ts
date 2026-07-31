// Duplication of src/integrations/notifications/index.ts - keep in sync.
import { execFile } from "child_process"
import { platform } from "os"

export interface NotificationOptions {
	title?: string
	subtitle?: string
	message: string
}

function escapePowerShellSingleQuotedString(value: string): string {
	return value.replace(/'/g, "''")
}

function encodePowerShellCommand(command: string): string {
	return Buffer.from(command, "utf16le").toString("base64")
}

export function buildWindowsToastNotificationScript(options: NotificationOptions): string {
	const { subtitle = "", message } = options
	const safeSubtitle = escapePowerShellSingleQuotedString(subtitle)
	const safeMessage = escapePowerShellSingleQuotedString(message)

	return `
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

    $subtitle = '${safeSubtitle}'
    $message = '${safeMessage}'

    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml('<toast><visual><binding template="ToastText02"><text id="1"></text><text id="2"></text></binding></visual></toast>')

    $textNodes = $xml.GetElementsByTagName('text')
    $textNodes.Item(0).InnerText = $subtitle
    $textNodes.Item(1).InnerText = $message

    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Cline').Show($toast)
    `
}

function escapeAppleScriptString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

export async function showSystemNotification(options: NotificationOptions): Promise<void> {
	const { title = "Cline", message } = options
	if (!message) return

	const normalizedOptions = { ...options, title, subtitle: options.subtitle || "" }

	switch (platform()) {
		case "darwin": {
			const script = `display notification "${escapeAppleScriptString(message)}" with title "${escapeAppleScriptString(title)}" subtitle "${escapeAppleScriptString(normalizedOptions.subtitle)}" sound name "Tink"`
			await new Promise<void>((resolve, reject) => {
				execFile("osascript", ["-e", script], (err) => (err ? reject(err) : resolve()))
			})
			break
		}
		case "win32": {
			const script = buildWindowsToastNotificationScript(normalizedOptions)
			const encodedScript = encodePowerShellCommand(script)
			await new Promise<void>((resolve, reject) => {
				execFile("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript], (err) =>
					err ? reject(err) : resolve(),
				)
			})
			break
		}
		case "linux": {
			const fullMessage = normalizedOptions.subtitle ? `${normalizedOptions.subtitle}\n${message}` : message
			await new Promise<void>((resolve, reject) => {
				execFile("notify-send", [title, fullMessage], (err) => (err ? reject(err) : resolve()))
			})
			break
		}
	}
}
