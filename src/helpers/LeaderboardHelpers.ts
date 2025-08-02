import { Context, TriggerContext } from "@devvit/public-api";
import { AppSetting } from "../settings.js";
import { LeaderboardEntry } from "../customPost/state.js";
import pluralize from "pluralize";
import { getSubredditName } from "../utility.js";

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

const POINTS_STORE_KEY = "thanksPointsStore";

export async function fetchLeaderboardEntries(
    context: TriggerContext,
    count: number
): Promise<LeaderboardEntry[]> {
    const settings = await context.settings.getAll();

    // Try to get subredditName from context.subredditName if available
    // or fallback to a helper function if you have one
    const subredditName =
        context.subredditName ?? (await getSubredditName(context));

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

export async function updateLeaderboardWiki(context: TriggerContext) {
    const settings = await context.settings.getAll();
    const subredditName = await getSubredditName(context);

    const pointName = settings[AppSetting.PointName] as string ?? "point";
    const redisKey = POINTS_STORE_KEY; // Use your constant

    // Fetch top leaderboard entries
    const rawSize = settings[AppSetting.LeaderboardSize];
    const leaderboardSize =
        typeof rawSize === "number"
            ? rawSize
            : typeof rawSize === "string" && !isNaN(Number(rawSize))
            ? Number(rawSize)
            : 20; // fallback default

    const leaderboardEntries = await fetchLeaderboardEntries(
        context,
        leaderboardSize
    );
    const rawPageSetting = settings[AppSetting.ScoreboardName];
    const scoreboard =
        typeof rawPageSetting === "string" ? rawPageSetting : "leaderboard";

    // Format leaderboard markdown text
    let wikiText = `# ${capitalize(scoreboard)} for r/${subredditName}\n\n| Rank | User | ${capitalize(pointName)}s |\n|---|---|---|\n`;

    for (const entry of leaderboardEntries) {
        const username = `${entry.username}`;
        wikiText += `| ${entry.rank} | ${username} | ${entry.score} |\n`;
    }

    // Update the wiki page
    try {
        await context.reddit.updateWikiPage({
            subredditName,
            page: scoreboard,
            content: wikiText,
            reason: `Updated leaderboard for ${scoreboard}`,
        });

        console.log(`✅ Updated leaderboard wiki page: ${scoreboard}`);
    } catch (error) {
        console.error("❌ Failed to update leaderboard wiki:", error);
    }
}
