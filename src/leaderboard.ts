import {
    JobContext,
    JSONObject,
    ScheduledJobEvent,
    WikiPage,
    WikiPagePermissionLevel,
} from "@devvit/public-api";
import { getSubredditName } from "./utility.js";
import { LeaderboardMode, AppSetting, TemplateDefaults } from "./settings.js";
import markdownEscape from "markdown-escape";
import pluralize from "pluralize";
import { format } from "date-fns";
import { logger } from "./logger.js";

const TIMEFRAMES = ["daily", "weekly", "monthly", "yearly", "alltime"] as const;

function leaderboardKey(timeframe: string): string {
    return timeframe === "alltime"
        ? "thanksPointsStore"
        : `thanksPointsStore:${timeframe}`;
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
            const daysUntilMonday = (8 - utcNow.getUTCDay()) % 7 || 7;
            utcNow.setUTCDate(utcNow.getUTCDate() + daysUntilMonday);
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
            return undefined;
        default:
            throw new Error(`Invalid timeframe: ${timeframe}`);
    }
}

export async function updateLeaderboard(
    event: ScheduledJobEvent<JSONObject | undefined>,
    context: JobContext
) {
    logger.info("\x1b[34m[Leaderboard] Update job started...\x1b[0m");

    const settings = await context.settings.getAll();
    const leaderboardMode = settings[AppSetting.LeaderboardMode] as
        | string[]
        | undefined;
    if (!leaderboardMode || leaderboardMode[0] === LeaderboardMode.Off) {
        logger.info("\x1b[33m[Leaderboard] Mode is OFF. Exiting.\x1b[0m");
        return;
    }

    const wikiPageName =
        (settings[AppSetting.ScoreboardLink] as string) ?? "leaderboards";
    if (!wikiPageName) {
        logger.warn(
            "\x1b[33m[Leaderboard] No wiki page name configured. Exiting.\x1b[0m"
        );
        return;
    }

    const leaderboardSize =
        (settings[AppSetting.LeaderboardSize] as number) ?? 20;
    const pointName = (settings[AppSetting.PointName] as string) ?? "point";
    const pointSymbol = (settings[AppSetting.PointSymbol] as string) ?? "";
    const subredditName = await getSubredditName(context);
    if (!subredditName) {
        logger.error(
            "\x1b[31m[Leaderboard] Could not determine subreddit name.\x1b[0m"
        );
        return;
    }

    const formattedDate = format(new Date(), "MM/dd/yyyy HH:mm:ss");
    let markdown = `# Leaderboards for r/${subredditName}\n`;

    const helpPage = settings[AppSetting.LeaderboardHelpPage] as
        | string
        | undefined;
    const helpMessageTemplate =
        TemplateDefaults.LeaderboardHelpPageMessage as string;
    // Add help message if configured
    if (helpPage && helpMessageTemplate) {
        markdown += `${helpMessageTemplate.replace("{{help}}", helpPage)}\n`;
    }

    const correctPermissionLevel =
        leaderboardMode[0] === LeaderboardMode.Public
            ? WikiPagePermissionLevel.SUBREDDIT_PERMISSIONS
            : WikiPagePermissionLevel.MODS_ONLY;

    for (const timeframe of TIMEFRAMES) {
        const redisKey = leaderboardKey(timeframe);
        const scores = await context.redis.zRange(
            redisKey,
            0,
            leaderboardSize - 1
        );

        const title =
            timeframe === "alltime" ? "All Time" : capitalize(timeframe);
        logger.info(
            `\x1b[34m[Leaderboard] Rendering ${title} leaderboard with ${scores.length} entries...\x1b[0m`
        );

        markdown += `\n\n## ${title}\n| Rank | User | ${capitalize(
            pointName
        )}${pluralize("", scores.length)} |\n|------|------|---------|\n`;

        if (scores.length === 0) {
            markdown += `| – | No data yet | – |\n`;
            logger.warn(
                `\x1b[33m[Leaderboard] No scores for ${title} — placeholder row added.\x1b[0m`
            );
        } else {
            for (let i = 0; i < scores.length; i++) {
                const entry = scores[i];
                const username = "member" in entry ? entry.member : entry[0];
                const score = "score" in entry ? entry.score : entry[1];
                const displayName = markdownEscape(username);
                const userPage = `user/${encodeURIComponent(username)}`;
                const userPageLink = `/r/${subredditName}/wiki/${userPage}`;
                markdown += `| ${
                    i + 1
                } | [${displayName}](${userPageLink}) | ${score}${pointSymbol} |\n`;

                try {
                    await context.reddit.getWikiPage(subredditName, userPage);
                    logger.debug(
                        `\x1b[90m[Leaderboard] Wiki exists: ${userPage}\x1b[0m`
                    );
                } catch {
                    const content = `This is the wiki page for u/${username}'s reputation in r/${subredditName}.`;
                    await context.reddit.createWikiPage({
                        subredditName,
                        page: userPage,
                        content,
                        reason: "Created leaderboard user page",
                    });
                    await context.reddit.updateWikiPageSettings({
                        subredditName,
                        page: userPage,
                        listed: true,
                        permLevel: correctPermissionLevel,
                    });
                    logger.info(
                        `\x1b[36m[Leaderboard] Created wiki page: ${username}\x1b[0m`
                    );
                }
            }
        }

        const expiry = expirationFor(timeframe);
        if (expiry) {
            const ttl = Math.floor((expiry.getTime() - Date.now()) / 1000);
            if (ttl > 0) {
                await context.redis.expire(redisKey, ttl);
                logger.debug(
                    `\x1b[90m[Leaderboard] Redis expiration set for ${title} — ${ttl}s\x1b[0m`
                );
            }
        }
    }

    markdown += `\n\n_Last updated: ${formattedDate} UTC`;

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
            logger.info("\x1b[32m[Leaderboard] Wiki content updated.\x1b[0m");
        }

        const wikiSettings = await wikiPage.getSettings();
        if (wikiSettings.permLevel !== correctPermissionLevel) {
            await context.reddit.updateWikiPageSettings({
                subredditName,
                page: wikiPageName,
                listed: true,
                permLevel: correctPermissionLevel,
            });
            logger.info(
                "\x1b[32m[Leaderboard] Wiki permissions updated.\x1b[0m"
            );
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
        logger.info(
            "\x1b[36m[Leaderboard] Wiki page created and configured.\x1b[0m"
        );
    }

    logger.info("\x1b[32m[Leaderboard] Update job completed.\x1b[0m");
}

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}
