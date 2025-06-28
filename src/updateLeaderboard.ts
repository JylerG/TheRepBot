import { TriggerContext } from "@devvit/public-api";
import { format } from "date-fns";
import { AppSetting } from "./settings.js";

const TIMEFRAMES = ["daily", "weekly", "monthly", "yearly", "alltime"] as const;
const MAX_LEADERBOARD_ENTRIES = 25;

function leaderboardKey(timeframe: string): string {
    return timeframe === "alltime" ? "thanksPointsStore" : `thanksPointsStore:${timeframe}`;
}

function expirationSeconds(timeframe: string): number | undefined {
    switch (timeframe) {
        case "daily": return 60 * 60 * 48; // 2 days
        case "weekly": return 60 * 60 * 24 * 10; // 10 days
        case "monthly": return 60 * 60 * 24 * 40; // 40 days
        case "yearly": return 60 * 60 * 24 * 400; // 400 days
        default: return undefined;
    }
}

export async function updateLeaderboard(context: TriggerContext): Promise<void> {
    const settings = await context.settings.getAll();
    const subredditName = context.subredditName ?? await context.reddit.getCurrentSubreddit().then(s => s.name);
    const pointName = settings[AppSetting.PointName] as string ?? "point";
    const pointSymbol = settings[AppSetting.PointSymbol] as string ?? "";
    const leaderboardWiki = settings[AppSetting.LeaderboardWikiPage] as string ?? "leaderboard";

    const now = new Date();
    const formattedDate = format(now, "yyyy-MM-dd HH:mm:ss");

    let markdown = `# Leaderboards\n_Last updated: ${formattedDate}_\n`;

    for (const timeframe of TIMEFRAMES) {
        const redisKey = leaderboardKey(timeframe);
        const scores = await context.redis.zRange(redisKey, 0, Number(settings[AppSetting.LeaderboardSize]) - 1);

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
