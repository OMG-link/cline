import { describe, expect, it } from "vitest"
import { providerAllowsCustomModelIds } from "./custom-model-ids"

describe("providerAllowsCustomModelIds", () => {
	it("returns true for the openai-compatible builtin and its spare slots", () => {
		expect(providerAllowsCustomModelIds("openai-compatible")).toBe(true)
		// Spare slots registered as builtins (see builtins.ts). They must accept
		// arbitrary user-supplied model ids just like the base openai-compatible.
		expect(providerAllowsCustomModelIds("openai-compatible-1")).toBe(true)
		expect(providerAllowsCustomModelIds("openai-compatible-2")).toBe(true)
		expect(providerAllowsCustomModelIds("openai-compatible-3")).toBe(true)
	})

	it("returns true for the extension's openai alias (maps to openai-compatible)", () => {
		expect(providerAllowsCustomModelIds("openai")).toBe(true)
	})

	it("returns true for other custom-model-id providers", () => {
		expect(providerAllowsCustomModelIds("ollama")).toBe(true)
		expect(providerAllowsCustomModelIds("lmstudio")).toBe(true)
		expect(providerAllowsCustomModelIds("litellm")).toBe(true)
	})

	it("returns false for providers with curated catalogs", () => {
		expect(providerAllowsCustomModelIds("anthropic")).toBe(false)
		expect(providerAllowsCustomModelIds("deepseek")).toBe(false)
	})
})
