import { describe, expect, it } from "vitest"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { convertClineMessageToProto, convertProtoToClineMessage } from "../shared/proto-conversions/cline-message"

describe("CommandState proto round-trip", () => {
	const statuses = [
		"pending",
		"running",
		"completed",
		"timeout_killed",
		"timeout_detached",
		"detached",
		"cancelled",
		"rejected",
		"failed",
		"unknown",
	] as const

	for (const status of statuses) {
		it(`round-trips status="${status}"`, () => {
			const message: ClineMessage = {
				ts: 1000,
				type: "say",
				say: "command",
				text: "echo hello",
				commandStates: [{ status, exitCode: 0, duration: 500, startedAt: 100 }],
				commandTimeoutMs: 30000,
			}
			const proto = convertClineMessageToProto(message)
			const restored = convertProtoToClineMessage(proto)
			expect(restored.commandStates?.[0]?.status).toBe(status)
		})
	}

	it("preserves exitCode, duration, startedAt", () => {
		const message: ClineMessage = {
			ts: 1000,
			type: "say",
			say: "command",
			text: "npm test",
			commandStates: [{ status: "completed", exitCode: 42, duration: 1234, startedAt: 999 }],
		}
		const restored = convertProtoToClineMessage(convertClineMessageToProto(message))
		expect(restored.commandStates?.[0]).toEqual({
			status: "completed",
			exitCode: 42,
			duration: 1234,
			startedAt: 999,
		})
	})

	it("omits zero-valued optional fields on proto->app conversion", () => {
		const message: ClineMessage = {
			ts: 1000,
			type: "say",
			say: "command",
			text: "ok",
			commandStates: [{ status: "completed", exitCode: 0, duration: 0, startedAt: 0 }],
		}
		const restored = convertProtoToClineMessage(convertClineMessageToProto(message))
		// Zero values are omitted (proto3 default), but status is always present
		expect(restored.commandStates?.[0]?.status).toBe("completed")
		expect(restored.commandStates?.[0]?.exitCode).toBeUndefined()
		expect(restored.commandStates?.[0]?.duration).toBeUndefined()
		expect(restored.commandStates?.[0]?.startedAt).toBeUndefined()
	})
})
