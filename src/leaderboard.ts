import {
    ScheduledJobEvent,
    JobContext,
    WikiPagePermissionLevel,
    JSONObject,
    Context,
} from "@devvit/public-api";
import { format, startOfWeek, startOfMonth, startOfYear } from "date-fns";
import { AppSetting, LeaderboardMode, TemplateDefaults } from "./settings.js";
import { getSubredditName } from "./utility.js";
import { StringLiteralLike } from "typescript";
import { logger } from "./logger.js";

export const TIMEFRAMES = [
    "daily",
    "weekly",
    "monthly",
    "yearly",
    "alltime",
] as const;

export function leaderboardKey(timeframe: string, subredditName?: string): string {
    const now = new Date();
    const safeSubreddit = subredditName ?? "subreddit"; // fallback if not passed

    switch (timeframe) {
        case "daily": {
            const date = now.toISOString().split("T")[0]; // YYYY-MM-DD
            return `thanksPointsStore:${safeSubreddit}:daily:${date}`;
        }
        case "weekly": {
            const startOfWeek = new Date(now);
            startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay());
            startOfWeek.setUTCHours(0, 0, 0, 0);
            const date = startOfWeek.toISOString().split("T")[0]; // YYYY-MM-DD
            return `thanksPointsStore:${safeSubreddit}:weekly:${date}`;
        }
        case "monthly": {
            const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
            const date = startOfMonth.toISOString().split("T")[0]; // YYYY-MM-01
            return `thanksPointsStore:${safeSubreddit}:monthly:${date}`;
        }
        case "yearly": {
            const year = now.getUTCFullYear();
            return `thanksPointsStore:${safeSubreddit}:yearly:${year}`;
        }
        case "alltime": {
            return `thanksPointsStore:${safeSubreddit}:alltime`;
        }
        default:
            throw new Error(`Unknown timeframe: ${timeframe}`);
    }
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

    const onlyShowAllTime = true;
    // TODO: Re-enable this setting if implementability is made possible
    // const onlyShowAllTime =
    //     (
    //         settings[AppSetting.OnlyShowAllTimeScoreboard] as
    //             | string[]
    //             | undefined
    //     )?.[0] === "true";

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

    const allScores: { member: string; score: number }[] = [];

    if (onlyShowAllTime) {
        const redisKey = leaderboardKey("alltime", subredditName);
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
        allScores.push(...scores);

        const expiry = expirationFor("alltime");
        if (expiry) {
            const ttl = Math.floor((expiry.getTime() - Date.now()) / 1000);
            if (ttl > 0) {
                await context.redis.expire(redisKey, ttl);
            }
        }
    } else {
        for (const timeframe of TIMEFRAMES) {
            let sectionMarkdown = "";
            let scores: { member: string; score: number }[] = [];
            const redisKey = leaderboardKey(timeframe, subredditName);

            switch (timeframe) {
                case "daily":
                    ({ markdown: sectionMarkdown, scores } =
                        await buildOrUpdateDailyLeaderboard(
                            context,
                            subredditName,
                            redisKey,
                            pointName,
                            pointSymbol,
                            leaderboardSize
                        ));
                    break;

                case "weekly":
                    ({ markdown: sectionMarkdown, scores } =
                        await buildOrUpdateWeeklyLeaderboard(
                            context,
                            subredditName,
                            redisKey,
                            pointName,
                            pointSymbol,
                            leaderboardSize
                        ));
                    break;

                case "monthly":
                    ({ markdown: sectionMarkdown, scores } =
                        await buildOrUpdateMonthlyLeaderboard(
                            context,
                            subredditName,
                            redisKey,
                            pointName,
                            pointSymbol,
                            leaderboardSize
                        ));
                    break;

                case "yearly":
                    ({ markdown: sectionMarkdown, scores } =
                        await buildOrUpdateYearlyLeaderboard(
                            context,
                            subredditName,
                            redisKey,
                            pointName,
                            pointSymbol,
                            leaderboardSize
                        ));
                    break;

                case "alltime":
                    ({ markdown: sectionMarkdown, scores } =
                        await buildOrUpdateAllTimeLeaderboard(
                            context,
                            subredditName,
                            redisKey,
                            pointName,
                            pointSymbol,
                            leaderboardSize
                        ));
                    break;

                default:
                    throw new Error(`Unknown timeframe: ${timeframe}`);
            }
            if (timeframe !== "alltime") {
                markdown += `\n\n## ${capitalize(
                    timeframe
                )}\n${sectionMarkdown}`;
            } else {
                markdown += `\n\n## All Time\n${sectionMarkdown}`;
            }
            allScores.push(...scores);

            const expiry = expirationFor(timeframe);
            if (expiry) {
                const ttl = Math.floor((expiry.getTime() - Date.now()) / 1000);
                if (ttl > 0) {
                    await context.redis.expire(redisKey, ttl);
                }
            }
        }
    }

    // Build user pages once per unique user
    const uniqueUsers = new Map<string, number>();
    for (const { member, score } of allScores) {
        if (
            !uniqueUsers.has(member) ||
            score > (uniqueUsers.get(member) ?? 0)
        ) {
            uniqueUsers.set(member, score);
        }
    }

    for (const [member, score] of uniqueUsers.entries()) {
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

export async function buildOrUpdateDailyLeaderboard(
    context: JobContext,
    subredditName: string,
    redisKey: string,
    pointName: string,
    pointSymbol: string,
    leaderboardSize: number
): Promise<{ markdown: string; scores: { member: string; score: number }[] }> {
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);

    const scores = await context.redis.zRange(
        redisKey,
        0,
        leaderboardSize - 1,
        {
            by: "score",
            reverse: true, // highest score first
        }
    );

    logger.debug("📊 Daily Leaderboard Fetched", {
    timeframe: "daily",
    redisKey,
    scoresPreview: scores.slice(0, 10),
    totalScores: scores.length,
});


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

    // ⏰ Set Redis key to expire at next 00:00 UTC
    const tomorrow = new Date(todayUTC);
    tomorrow.setUTCDate(todayUTC.getUTCDate() + 1);
    const ttlSeconds = Math.floor((tomorrow.getTime() - Date.now()) / 1000);

    if (ttlSeconds > 0) {
        await context.redis.expire(redisKey, ttlSeconds);
    }

    return { markdown, scores };
}

export async function buildOrUpdateWeeklyLeaderboard(
    context: JobContext,
    subredditName: string,
    redisKey: string,
    pointName: string,
    pointSymbol: string,
    leaderboardSize: number
): Promise<{ markdown: string; scores: { member: string; score: number }[] }> {
    const now = new Date();

    // 📅 Get the start of the week (Sunday 00:00 UTC)
    const startOfWeekUTC = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    startOfWeekUTC.setUTCDate(
        startOfWeekUTC.getUTCDate() - startOfWeekUTC.getUTCDay()
    );
    startOfWeekUTC.setUTCHours(0, 0, 0, 0);

    const scores = await context.redis.zRange(
        redisKey,
        0,
        leaderboardSize - 1,
        {
            by: "score",
            reverse: true,
        }
    );

    logger.debug("📊 Weekly Leaderboard Fetched", {
    timeframe: "weekly",
    redisKey,
    scoresPreview: scores.slice(0, 10),
    totalScores: scores.length,
});


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

    // ⏰ Set expiration to next Sunday 00:00 UTC
    const nextSundayUTC = new Date(startOfWeekUTC);
    nextSundayUTC.setUTCDate(startOfWeekUTC.getUTCDate() + 7); // next week
    nextSundayUTC.setUTCHours(0, 0, 0, 0);

    const ttlSeconds = Math.floor(
        (nextSundayUTC.getTime() - Date.now()) / 1000
    );
    if (ttlSeconds > 0) {
        await context.redis.expire(redisKey, ttlSeconds);
    }

    return { markdown, scores };
}

export async function buildOrUpdateMonthlyLeaderboard(
    context: JobContext,
    subredditName: string,
    redisKey: string,
    pointName: string,
    pointSymbol: string,
    leaderboardSize: number
): Promise<{ markdown: string; scores: { member: string; score: number }[] }> {
    const now = new Date();

    const scores = await context.redis.zRange(
        redisKey,
        0,
        leaderboardSize - 1,
        {
            by: "score",
            reverse: true, // highest first
        }
    );

    logger.debug("📊 Monthly Leaderboard Fetched", {
    timeframe: "monthly",
    redisKey,
    scoresPreview: scores.slice(0, 10),
    totalScores: scores.length,
});


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

    // ⏰ Set Redis expiration to 1st of next month at 00:00 UTC
    const nextMonthUTC = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    );
    const ttlSeconds = Math.floor((nextMonthUTC.getTime() - Date.now()) / 1000);

    if (ttlSeconds > 0) {
        await context.redis.expire(redisKey, ttlSeconds);
    }

    return { markdown, scores };
}

export async function buildOrUpdateYearlyLeaderboard(
    context: JobContext,
    subredditName: string,
    redisKey: string,
    pointName: string,
    pointSymbol: string,
    leaderboardSize: number
): Promise<{ markdown: string; scores: { member: string; score: number }[] }> {
    const now = new Date();
    const year = now.getUTCFullYear();


    const scores = await context.redis.zRange(
        redisKey,
        0,
        leaderboardSize - 1,
        {
            by: "score",
            reverse: true,
        }
    );

    logger.debug("📊 Yearly Leaderboard Fetched", {
    timeframe: "yearly",
    redisKey,
    scoresPreview: scores.slice(0, 10),
    totalScores: scores.length,
});


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

    // ⏰ Set expiration to January 1st of next year, 00:00 UTC
    const nextYear = new Date(Date.UTC(year + 1, 0, 1));
    const ttlSeconds = Math.floor((nextYear.getTime() - Date.now()) / 1000);

    if (ttlSeconds > 0) {
        await context.redis.expire(redisKey, ttlSeconds);
    }

    return { markdown, scores };
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

    logger.debug("📊 AllTime Leaderboard Fetched", {
    timeframe: "alltime",
    redisKey,
    scoresPreview: scores.slice(0, 10),
    totalScores: scores.length,
});


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

function getRedisKey(subredditName: string, timeframe: string): string {
    const now = new Date();
    let dateSuffix = "";

    switch (timeframe) {
        case "daily":
            dateSuffix = format(now, "yyyy-MM-dd");
            break;
        case "weekly":
            dateSuffix = format(
                startOfWeek(now, { weekStartsOn: 0 }),
                "yyyy-MM-dd"
            ); // Sunday UTC
            break;
        case "monthly":
            dateSuffix = format(startOfMonth(now), "yyyy-MM");
            break;
        case "yearly":
            dateSuffix = format(startOfYear(now), "yyyy");
            break;
        case "alltime":
            return `thanksPointsStore${subredditName}:alltime`;
        default:
            throw new Error(`Invalid timeframe: ${timeframe}`);
    }

    return `thanksPointsStore${subredditName}:${timeframe}:${dateSuffix}`;
}
