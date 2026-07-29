import { Empty } from "@/shared/proto/cline/common"
import { ProviderListingsResponse } from "@/shared/proto/cline/models"
import {
	hasProviderCatalogStateController,
	type ProviderCatalogController,
	toProviderListingProto,
} from "./providerCatalogShared"

export async function listProviders(controller: ProviderCatalogController, _request: Empty): Promise<ProviderListingsResponse> {
	const providers = await controller.getProviderCatalog().listProviders()
	let lastUsedAt: Record<string, string> = {}
	if (hasProviderCatalogStateController(controller)) {
		lastUsedAt = controller.stateManager.getGlobalStateKey?.("providerLastUsedAt") ?? {}
	}
	const sorted = [...providers].sort((a, b) => {
		const ta = lastUsedAt[a.id as string]
		const tb = lastUsedAt[b.id as string]
		if (ta && tb) return tb.localeCompare(ta)
		if (ta) return -1
		if (tb) return 1
		return 0
	})
	return ProviderListingsResponse.create({
		providers: sorted.map(toProviderListingProto),
	})
}
