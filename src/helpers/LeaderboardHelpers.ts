import { Context } from "@devvit/public-api";
import { AppSetting } from "../settings.js";
import { POINTS_STORE_KEY } from "../thanksPoints.js";
import { LeaderboardEntry } from "../customPost/state.js";

export async function fetchLeaderboardEntries(
    context: Context,
    size: number
): Promise<LeaderboardEntry[]> {
    const leaderboard: LeaderboardEntry[] = [];
    const items = await context.redis.zRange(
        POINTS_STORE_KEY,
        0,
        size - 1,
        { by: "score", reverse: true }
    );
    let rank = 1;
    const settings = await context.settings.getAll();
    for (const item of items) {
        leaderboard.push({
            username: item.member,
            score: item.score,
            rank: rank++,
            pointName: (settings[AppSetting.PointName] as string) ?? "point",
        });
    }

    return leaderboard;
}
