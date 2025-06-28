import { TriggerContext } from "@devvit/public-api";
import { format } from "date-fns";
import { AppSetting } from "./settings.js";

const TimeFrames = ["daily", "weekly", "monthly", "yearly", "alltime"] as const;
const MaxLeaderBoardEntries = 25;

function leaderboardKey(timeframe: string): string {
    return timeframe === "alltime" ? "thanksPointsStore" : `thanksPointsStore:${timeframe}`;
}

function expirationSeconds(timeframe: string): number | undefined {
    switch (timeframe) {
        case "daily": return 60 * 60 * 24; // 1 day
        case "weekly": return 60 * 60 * 24 * 7; // 7 days
        case "monthly": return 60 * 60 * 24 * 30; // 30 days
        case "yearly": return 60 * 60 * 24 * 365; // 365 days
        default: return undefined;
    }
}

export async function updateLeaderboard(context: TriggerContext): Promise<void> {
    const settings = await context.settings.getAll();
    const subredditName = context.subredditName ?? await context.reddit.getCurrentSubreddit().then(s => s.name);
    const pointName = settings[AppSetting.PointName] as string ?? "point";
    const pointSymbol = settings[AppSetting.PointSymbol] as string ?? "";
    const leaderboardWiki = settings[AppSetting.LeaderboardWikiPage] as string ?? "leaderboard";

    const leaderboardSize = Number(settings[AppSetting.LeaderboardSize]) || MaxLeaderBoardEntries;

    const now = new Date();
    const formattedDate = format(now, "yyyy-MM-dd HH:mm:ss");

    let markdown = `# Leaderboards\nLast updated: ${formattedDate} UTC\n`;

    for (const timeframe of TimeFrames) {
        const redisKey = leaderboardKey(timeframe);
        const scores = await context.redis.zRange(redisKey, 0, leaderboardSize - 1);

        if (!scores.length) continue;

        markdown += `\n\n## ${capitalize(timeframe)} Leaderboard`;
        markdown += `\n| Rank | User | ${capitalize(pointName)}s |`;
        markdown += `\n|------|------|--------|`;

        for (let i = 0; i < scores.length; i++) {
            const { member: username, score } = scores[i];
            const displayName = markdownEscape(username);
            const userPageLink = `/r/${subredditName}/wiki/user/${encodeURIComponent(username)}`;
            markdown += `\n| ${i + 1} | [${displayName}](${userPageLink}) | ${score}${pointSymbol} |`;
        }

        // Apply expiration if applicable
        const expiry = expirationSeconds(timeframe);
        if (expiry) {
            await context.redis.expire(redisKey, expiry);
        }
    }

    if (!subredditName) {
        throw new Error("subredditName is undefined.");
    }

    await context.reddit.updateWikiPage({
        subredditName,
        page: leaderboardWiki,
        content: markdown,
        reason: `Updated leaderboard on ${formattedDate}`,
    });
}

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function markdownEscape(input: string): string {
    return input.replace(/([\\`*_{}\[\]()#+\-.!])/g, "\\$1");
}
