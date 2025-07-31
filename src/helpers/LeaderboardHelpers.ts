import { Context, TriggerContext } from "@devvit/public-api";
import { AppSetting } from "../settings.js";
import { LeaderboardEntry } from "../customPost/state.js";
import pluralize from "pluralize";

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

const POINTS_STORE_KEY = "thanksPointsStore";

export async function fetchLeaderboardEntries(
    context: Context,
    count: number
): Promise<LeaderboardEntry[]> {
    const settings = await context.settings.getAll();
    const subredditName = (await context.reddit.getCurrentSubreddit()).name;
    const pointName =
        (settings[AppSetting.PointName] as string | undefined) ?? "point";
    const redisKey = `${POINTS_STORE_KEY}`;

    const results = await context.redis.zRange(redisKey, 0, count, {
        by: "score",
        reverse: true,
    });

    const resultsWithScores = results.map((entry, index) => ({
        username: entry.member,
        score: Number(entry.score),
        rank: index + 1,
        pointName: capitalize(pluralize(pointName)),
    }));

    return resultsWithScores;
}