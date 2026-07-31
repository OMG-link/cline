import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./main.css"
import "./index.css"
import App from "./App.tsx"
import { installWebviewNotificationListener } from "./services/webview-notifications"

// Activate the webview notification bridge so the extension host can ask
// the webview (which runs locally, even in Remote-SSH) to fire an OS-level
// Notification when the VS Code window is unfocused.
installWebviewNotificationListener()

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
