import {
  authenticateRequest,
  deriveProfileIdentity,
  fetchPrivyUser,
} from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/db.ts";
import { refreshHolderStatus } from "../_shared/holder.ts";
import { jsonResponse, withHttp } from "../_shared/http.ts";
import {
  ensurePlayer,
  getProfile,
  refreshLeaderboardIdentity,
} from "../_shared/players.ts";
import { checkPreAuthRateLimit, checkRateLimit } from "../_shared/rateLimit.ts";

Deno.serve((req) =>
  withHttp(async (request) => {
    checkPreAuthRateLimit(request, "profile", { limit: 120 });
    const admin = getAdminClient();
    const caller = await authenticateRequest(request);
    await checkRateLimit(admin, request, "profile", caller.userId, 60);

    const privyUser = await fetchPrivyUser(caller.userId);
    const identity = deriveProfileIdentity(caller.userId, privyUser);

    await ensurePlayer(admin, {
      id: caller.userId,
      name: identity.name,
      avatar: identity.avatar,
      walletAddress: identity.walletAddress,
    });

    const currentProfile = await getProfile(admin, caller.userId);
    await refreshHolderStatus(
      admin,
      caller.userId,
      identity.walletAddress ?? currentProfile.walletAddress,
    );

    const profile = await getProfile(admin, caller.userId);
    await refreshLeaderboardIdentity(admin, profile);

    return jsonResponse(profile);
  }, req)
);
