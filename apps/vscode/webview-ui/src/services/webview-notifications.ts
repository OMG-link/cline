/**
 * Webview-side notification bridge.
 *
 * Listens for `cline_notification` messages posted from the extension host
 * and attempts to fire a browser `Notification`.  The webview runs locally
 * (in the renderer process) even when the extension host is remote
 * (Remote-SSH), so a `new Notification()` here can produce a true OS-level
 * toast on the user's machine.
 *
 * Diagnostic logs are written to the webview developer console so the user
 * can verify whether the Notification API is available and what permission
 * state it is in.
 */

interface ClineNotificationMessage {
	type: "cline_notification"
	notification: {
		kind: "approval" | "completion" | "error" | "question"
		title: string
		body: string
	}
}

function isClineNotificationMessage(data: unknown): data is ClineNotificationMessage {
	return (
		typeof data === "object" &&
		data !== null &&
		(data as Record<string, unknown>).type === "cline_notification" &&
		typeof (data as Record<string, unknown>).notification === "object"
	)
}

let permissionRequested = false

async function tryShowNotification(title: string, body: string): Promise<boolean> {
	if (typeof Notification === "undefined") {
		console.warn("[Cline Notify] Notification API unavailable in this webview")
		return false
	}

	console.log(`[Cline Notify] permission=${Notification.permission}, title=${title}`)

	if (Notification.permission === "granted") {
		new Notification(title, { body })
		return true
	}

	if (Notification.permission === "denied") {
		console.warn("[Cline Notify] permission denied – enable notifications in browser settings")
		return false
	}

	// "default" – request permission once.
	if (!permissionRequested) {
		permissionRequested = true
		try {
			console.log("[Cline Notify] requesting permission…")
			const permission = await Notification.requestPermission()
			console.log(`[Cline Notify] permission result: ${permission}`)
			if (permission === "granted") {
				new Notification(title, { body })
				return true
			}
		} catch (err) {
			console.warn("[Cline Notify] requestPermission threw:", err)
		}
	}

	return false
}

/**
 * Install the webview notification listener. Call once at webview startup.
 * Returns a cleanup function.
 */
export function installWebviewNotificationListener(): () => void {
	const handler = (event: MessageEvent) => {
		const data = event.data
		if (!isClineNotificationMessage(data)) {
			return
		}
		const { title, body } = data.notification
		void tryShowNotification(title, body)
	}

	window.addEventListener("message", handler)

	return () => {
		window.removeEventListener("message", handler)
	}
}
