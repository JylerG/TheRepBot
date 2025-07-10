import {
    ScheduledJobEvent,
    JobContext,
    WikiPagePermissionLevel,
    JSONObject,
} from "@devvit/public-api";
import { format } from "date-fns";
import { AppSetting, LeaderboardMode, TemplateDefaults } from "./settings.js";
import { getSubredditName } from "./utility.js";

export const TIMEFRAMES = [
    "daily",
    "weekly",
    "monthly",
    "yearly",
    "alltime",
] as const;

function leaderboardKey(timeframe: string): string {
    return timeframe === "alltime"
        ? "thanksPointsStore"
        : `thanksPointsStore:${timeframe}`;
}

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function markdownEscape(input: string): string {
    return input.replace(/([\\`*_{}\[\]()#+\-.!])/g, "\\$1");
}

function expirationFor(timeframe: string): Date | undefined {
    const now = new Date();
    const utcNow = new Date(
        Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            now.getUTCHours(),
            now.getUTCMinutes(),
            now.getUTCSeconds()
        )
    );
    switch (timeframe) {
        case "daily":
            utcNow.setUTCDate(utcNow.getUTCDate() + 1);
            utcNow.setUTCHours(0, 0, 0, 0);
            return utcNow;
        case "weekly": {
            const daysUntilSunday = (7 - utcNow.getUTCDay()) % 7;
            utcNow.setUTCDate(utcNow.getUTCDate() + daysUntilSunday);
            utcNow.setUTCHours(0, 0, 0, 0);
            return utcNow;
        }
        case "monthly":
            return new Date(
                Date.UTC(utcNow.getUTCFullYear(), utcNow.getUTCMonth() + 1, 1)
            );
        case "yearly":
            return new Date(Date.UTC(utcNow.getUTCFullYear() + 1, 0, 1));
        case "alltime":
        default:
            return undefined;
    }
}

export async function updateLeaderboard(
    event: ScheduledJobEvent<JSONObject | undefined>,
    context: JobContext
) {
    const settings = await context.settings.getAll();
    const leaderboardMode = settings[AppSetting.LeaderboardMode] as
        | string[]
        | undefined;
    if (!leaderboardMode || leaderboardMode[0] === LeaderboardMode.Off) return;

    const wikiPageName =
        (settings[AppSetting.ScoreboardLink] as string) ?? "leaderboards";
    if (!wikiPageName.trim()) return;

    const leaderboardSize =
        (settings[AppSetting.LeaderboardSize] as number) ?? 10;
    const pointName = (settings[AppSetting.PointName] as string) ?? "point";
    const pointSymbol = (settings[AppSetting.PointSymbol] as string) ?? "";
    const subredditName = await getSubredditName(context);
    if (!subredditName) return;

    const formattedDate = format(new Date(), "MM/dd/yyyy HH:mm:ss");
    let markdown = `# ${capitalize(pointName)}boards for r/${subredditName}\n`;

    const helpPage = settings[AppSetting.LeaderboardHelpPage] as
        | string
        | undefined;
    const helpMessageTemplate =
        TemplateDefaults.LeaderboardHelpPageMessage as string;
    if (helpPage?.trim()) {
        markdown += `${helpMessageTemplate.replace("{{help}}", helpPage)}\n\n`;
    }

    const correctPermissionLevel =
        leaderboardMode[0] === LeaderboardMode.Public
            ? WikiPagePermissionLevel.SUBREDDIT_PERMISSIONS
            : WikiPagePermissionLevel.MODS_ONLY;

    const redisKey = leaderboardKey("alltime");
    const { markdown: tableMarkdown, scores } =
        await buildOrUpdateAllTimeLeaderboard(
            context,
            subredditName,
            redisKey,
            pointName,
            pointSymbol,
            leaderboardSize
        );

    markdown += `\n\n${tableMarkdown}`;

    for (const { member, score } of scores) {
        await buildOrUpdateUserPage(context, {
            member,
            score,
            subredditName,
            pointName,
            pointSymbol,
            formattedDate,
            correctPermissionLevel,
        });
    }

    const expiry = expirationFor("alltime");
    if (expiry) {
        const ttl = Math.floor((expiry.getTime() - Date.now()) / 1000);
        if (ttl > 0) {
            await context.redis.expire(redisKey, ttl);
        }
    }

    try {
        const wikiPage = await context.reddit.getWikiPage(
            subredditName,
            wikiPageName
        );
        if (wikiPage.content !== markdown) {
            await context.reddit.updateWikiPage({
                subredditName,
                page: wikiPageName,
                content: markdown,
                reason: `Updated ${formattedDate}`,
            });
        }

        const wikiSettings = await wikiPage.getSettings();
        if (wikiSettings.permLevel !== correctPermissionLevel) {
            await context.reddit.updateWikiPageSettings({
                subredditName,
                page: wikiPageName,
                listed: true,
                permLevel: correctPermissionLevel,
            });
        }
    } catch {
        await context.reddit.createWikiPage({
            subredditName,
            page: wikiPageName,
            content: markdown,
            reason: `Initial setup`,
        });
        await context.reddit.updateWikiPageSettings({
            subredditName,
            page: wikiPageName,
            listed: true,
            permLevel: correctPermissionLevel,
        });
    }
}

async function buildOrUpdateUserPage(
    context: JobContext,
    {
        member,
        score,
        subredditName,
        pointName,
        pointSymbol,
        formattedDate,
        correctPermissionLevel,
    }: {
        member: string;
        score: number;
        subredditName: string;
        pointName: string;
        pointSymbol: string;
        formattedDate: string;
        correctPermissionLevel: WikiPagePermissionLevel;
    }
) {
    const userPage = `user/${encodeURIComponent(member)}`;
    const userAwardsKey = `user_awards:${member}`;
    let awardedPosts: Array<{ date: number; title: string; link: string }> = [];

    try {
        const rawPosts = await context.redis.zRange(userAwardsKey, 0, 9);
        awardedPosts = rawPosts
            .map((entry) => {
                try {
                    return JSON.parse(
                        typeof entry === "string" ? entry : entry.member
                    );
                } catch {
                    return null;
                }
            })
            .filter(Boolean) as Array<{
            date: number;
            title: string;
            link: string;
        }>;
    } catch {
        awardedPosts = [];
    }

    let userPageContent = `# ${capitalize(
        pointName
    )}s for u/${member}\n\n**Total:** ${score}${pointSymbol}\n\n`;

    if (awardedPosts.length > 0) {
        userPageContent += `# Snipe History for u/${member}\n\n| Date | Submission |\n|------|------------|\n`;
        for (const award of awardedPosts) {
            const dateStr = format(
                new Date(award.date * 1000),
                "MM/dd/yyyy HH:mm:ss"
            );
            const safeTitle = markdownEscape(award.title);
            userPageContent += `| ${dateStr} | [${safeTitle}](${award.link}) |\n`;
        }
    } else {
        userPageContent += `| – | No data yet | – |\n`;
    }

    userPageContent += `\nLast updated: ${formattedDate} UTC`;

    try {
        const userWikiPage = await context.reddit.getWikiPage(
            subredditName,
            userPage
        );
        if (userWikiPage.content !== userPageContent.trim()) {
            await context.reddit.updateWikiPage({
                subredditName,
                page: userPage,
                content: userPageContent.trim(),
                reason: `Update user score data for ${member}`,
            });
        }

        const userWikiSettings = await userWikiPage.getSettings();
        if (
            userWikiSettings.permLevel !== correctPermissionLevel ||
            userWikiSettings.listed !== true
        ) {
            await context.reddit.updateWikiPageSettings({
                subredditName,
                page: userPage,
                listed: true,
                permLevel: correctPermissionLevel,
            });
        }
    } catch {
        await context.reddit.createWikiPage({
            subredditName,
            page: userPage,
            content: userPageContent.trim(),
            reason: "Created user score data page",
        });
        await context.reddit.updateWikiPageSettings({
            subredditName,
            page: userPage,
            listed: true,
            permLevel: correctPermissionLevel,
        });
    }
}

async function buildOrUpdateLeaderboardForAllTimeframes(
    context: JobContext,
    subredditName: string,
    pointName: string,
    pointSymbol: string,
    leaderboardSize: number,
    formattedDate: string,
    timeframe: string,
    correctPermissionLevel: WikiPagePermissionLevel
): Promise<string> {
    let markdown = "";

    const redisKey = leaderboardKey(timeframe);
    const title = capitalize(timeframe);

    markdown += `## ${title}\n\n`; // Add heading + blank line

    // Fetch scores sorted by score descending
    const scores: { member: string; score: number }[] =
        await context.redis.zRange(redisKey, 0, leaderboardSize - 1, {
            by: "score",
            reverse: true,
        });

    // Add the table header always, for every timeframe
    markdown += `| Rank | User | ${capitalize(pointName)}${
        pointName.endsWith("s") ? "" : "s"
    } |\n`;
    markdown += `|------|------|---------|\n`;

    if (scores.length === 0) {
        markdown += `| – | No data yet | – |\n\n`; // "No data" row + blank line after
    } else {
        for (let i = 0; i < scores.length; i++) {
            const { member, score } = scores[i];
            const safeMember = markdownEscape(member);
            const userWikiLink = `/r/${subredditName}/wiki/user/${encodeURIComponent(
                member
            )}`;
            markdown += `| ${
                i + 1
            } | [${safeMember}](${userWikiLink}) | ${score}${pointSymbol} |\n`;

            // Update user page
            await buildOrUpdateUserPage(context, {
                member,
                score,
                subredditName,
                pointName,
                pointSymbol,
                formattedDate,
                correctPermissionLevel,
            });
        }

        markdown += `\n`; // blank line after each table
    }

    // Set Redis key expiration if applicable
    const expiry = expirationFor(timeframe);
    if (expiry) {
        const ttl = Math.floor((expiry.getTime() - Date.now()) / 1000);
        if (ttl > 0) {
            await context.redis.expire(redisKey, ttl);
        }
    }

    // Append last updated timestamp in UTC
    markdown += `Last updated: ${formattedDate} UTC`;

    return markdown;
}

export async function buildOrUpdateAllTimeLeaderboard(
    context: JobContext,
    subredditName: string,
    redisKey: string,
    pointName: string,
    pointSymbol: string,
    leaderboardSize: number
): Promise<{ markdown: string; scores: { member: string; score: number }[] }> {
    // Get top scores descending
    const scores = await context.redis.zRange(
        redisKey,
        0,
        leaderboardSize - 1,
        {
            by: "score",
            reverse: true, // highest score first
        }
    );

    let markdown = `| Rank | User | ${capitalize(pointName)}${
        pointName.endsWith("s") ? "" : "s"
    } |\n|------|------|---------|\n`;

    if (scores.length === 0) {
        markdown += `| – | No data yet | – |\n`;
    } else {
        for (let i = 0; i < scores.length; i++) {
            const { member, score } = scores[i];
            const safeMember = markdownEscape(member);
            const userWikiLink = `/r/${subredditName}/wiki/user/${encodeURIComponent(
                member
            )}`;
            markdown += `| ${
                i + 1
            } | [${safeMember}](${userWikiLink}) | ${score}${pointSymbol} |\n`;
        }
    }

    return { markdown, scores };
}
