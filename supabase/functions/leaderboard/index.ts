import { assertFreshPrivyUser, authenticateRequest } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/db.ts";
import { loadLeaderboardRows } from "../_shared/leaderboard.ts";
import { jsonResponse, withHttp } from "../_shared/http.ts";
import { checkPreAuthRateLimit, checkRateLimit } from "../_shared/rateLimit.ts";

Deno.serve((req) =>
  withHttp(async (request) => {
    checkPreAuthRateLimit(request, "leaderboard", { limit: 120 });
    const admin = getAdminClient();
    const caller = await authenticateRequest(request);
    await checkRateLimit(admin, request, "leaderboard", caller.userId, 90);
    await assertFreshPrivyUser(caller);

    const rows = await loadLeaderboardRows(admin, caller.userId);
    return jsonResponse({ rows });
  }, req)
);
