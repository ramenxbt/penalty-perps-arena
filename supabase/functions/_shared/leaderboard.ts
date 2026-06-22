import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";

export type BoardRow = {
  id: string;
  rank: number;
  name: string;
  avatar: string;
  score: number;
  streak: number;
  today: string;
  isAi: boolean;
  isHolder: boolean;
  movement: number;
};

type LeaderboardRow = {
  id: string;
  name: string;
  avatar: string;
  score: number;
  streak: number;
  today: string;
  is_ai: boolean;
  is_holder: boolean;
  movement: number;
  updated_at: string;
};

function mapLeaderboardRows(rows: LeaderboardRow[], rankOffset = 0): BoardRow[] {
  return rows.map((row, index) => ({
    id: row.id,
    rank: rankOffset + index + 1,
    name: row.name,
    avatar: row.avatar,
    score: row.score,
    streak: row.streak,
    today: row.today,
    isAi: row.is_ai,
    isHolder: row.is_holder,
    movement: row.movement,
  }));
}

async function countLeaderboardRows(
  admin: SupabaseClient,
  applyFilters: (query: any) => PromiseLike<{ count: number | null; error: Error | null }>,
): Promise<number> {
  const query = admin.from("leaderboard").select("id", { count: "exact", head: true });
  const { count, error } = await applyFilters(query);
  if (error) throw error;
  return count ?? 0;
}

async function leaderboardRank(admin: SupabaseClient, row: LeaderboardRow): Promise<number> {
  const [higherScore, earlierUpdatedAt, earlierId] = await Promise.all([
    countLeaderboardRows(admin, (query) => query.gt("score", row.score)),
    countLeaderboardRows(admin, (query) => query.eq("score", row.score).lt("updated_at", row.updated_at)),
    countLeaderboardRows(admin, (query) =>
      query.eq("score", row.score).eq("updated_at", row.updated_at).lt("id", row.id)
    ),
  ]);

  return higherScore + earlierUpdatedAt + earlierId + 1;
}

export async function loadLeaderboardRows(admin: SupabaseClient, callerId?: string): Promise<BoardRow[]> {
  const { data, error } = await admin
    .from("leaderboard")
    .select("id,name,avatar,score,streak,today,is_ai,is_holder,movement,updated_at")
    .order("score", { ascending: false })
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(50);

  if (error) throw error;

  const topRows = (data ?? []) as LeaderboardRow[];
  const mapped = mapLeaderboardRows(topRows);
  if (!callerId || topRows.some((row) => row.id === callerId)) return mapped;

  const { data: callerRow, error: callerError } = await admin
    .from("leaderboard")
    .select("id,name,avatar,score,streak,today,is_ai,is_holder,movement,updated_at")
    .eq("id", callerId)
    .maybeSingle();

  if (callerError) throw callerError;
  const row = callerRow as LeaderboardRow | null;
  if (!row) return mapped;

  return [...mapped, ...mapLeaderboardRows([row], await leaderboardRank(admin, row) - 1)];
}

export async function loadAiLeaderboardRows(admin: SupabaseClient, limit: number): Promise<BoardRow[]> {
  const { data, error } = await admin
    .from("leaderboard")
    .select("id,name,avatar,score,streak,today,is_ai,is_holder,movement")
    .eq("is_ai", true)
    .order("score", { ascending: false })
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);

  if (error) throw error;

  return mapLeaderboardRows((data ?? []) as LeaderboardRow[]);
}
