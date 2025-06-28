import {
    JobContext,
    JSONObject,
    ScheduledJobEvent,
    WikiPage,
    WikiPagePermissionLevel,
} from "@devvit/public-api";
import { getSubredditName } from "./utility.js";
import { LeaderboardMode, AppSetting } from "./settings.js";
import markdownEscape from "markdown-escape";
import pluralize from "pluralize";
import { format, startOfTomorrow } from "date-fns";
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
        case "daily": {
            const tomorrow = new Date(utcNow);
            tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
            tomorrow.setUTCHours(0, 0, 0, 0);
            return tomorrow;
        }
        case "weekly": {
            const dayOfWeek = utcNow.getUTCDay(); // 0 (Sun) to 6 (Sat)
            const daysUntilMonday = (8 - dayOfWeek) % 7 || 7;
            const nextMonday = new Date(utcNow);
            nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilMonday);
            nextMonday.setUTCHours(0, 0, 0, 0);
            return nextMonday;
        }
        case "monthly": {
            const nextMonth = new Date(
                Date.UTC(utcNow.getUTCFullYear(), utcNow.getUTCMonth() + 1, 1)
            );
            return nextMonth;
        }
        case "yearly": {
            const nextYear = new Date(
                Date.UTC(utcNow.getUTCFullYear() + 1, 0, 1)
            );
            return nextYear;
        }
        case "alltime":
          return undefined; // No expiration for all-time leaderboard
        default:
            throw new Error(`Invalid timeframe: ${timeframe}`);
    }
}

export async function updateLeaderboard(
    event: ScheduledJobEvent<JSONObject | undefined>,
    context: JobContext
) {
    logger.info("Leaderboard update job started.");

    const settings = await context.settings.getAll();
    logger.debug("Leaderboard: Settings loaded", settings);

    const leaderboardMode = settings[AppSetting.LeaderboardMode] as
        | string[]
        | undefined;
    if (!leaderboardMode || leaderboardMode[0] === LeaderboardMode.Off) {
        logger.info("Leaderboard mode is OFF. Exiting.");
        return;
    }

    const wikiPageName = settings[AppSetting.LeaderboardWikiPage] as
        | string
        | undefined;
    if (!wikiPageName) {
        logger.warn("No wiki page name configured. Exiting.");
        return;
    }

    const leaderboardSize =
        (settings[AppSetting.LeaderboardSize] as number) ?? 20;
    const pointName = (settings[AppSetting.PointName] as string) ?? "point";
    const pointSymbol = (settings[AppSetting.PointSymbol] as string) ?? "";

    const subredditName = await getSubredditName(context);
    if (!subredditName) {
        await logger.error("Could not determine subreddit name.");
        return;
    }

    const now = new Date();
    const formattedDate = format(now, "MM/dd/yyyy HH:mm:ss");
    logger.debug("Updating leaderboard", { subredditName, formattedDate });

    let markdown = `# Leaderboards for r/${subredditName}\n`;

    const helpPage = settings[AppSetting.LeaderboardHelpPage] as
        | string
        | undefined;
    const helpMessageTemplate = settings[
        AppSetting.LeaderboardHelpPageMessage
    ] as string | undefined;

    if (helpPage && helpMessageTemplate) {
        const renderedHelp = helpMessageTemplate.replace("{help}", helpPage);
        markdown += `${renderedHelp}\n`;
    }

    for (const timeframe of TIMEFRAMES) {
        const redisKey = leaderboardKey(timeframe);
        const scores = await context.redis.zRange(
            redisKey,
            0,
            leaderboardSize - 1
        );

        const title =
            timeframe === "alltime" ? "All Time" : capitalize(timeframe);
        logger.info(`Rendering ${title} leaderboard`, {
            scoreCount: scores.length,
        });

        markdown += `\n\n## ${title}\n`;
        markdown += `| Rank | User | ${capitalize(pointName)}${pluralize(
            "",
            scores.length
        )} |\n`;
        markdown += `|------|------|---------|\n`;

        if (scores.length === 0) {
            markdown += `| – | No data yet | – |\n`;
            logger.warn(`No scores found for ${title}. Added placeholder row.`);
        } else {
            for (let i = 0; i < scores.length; i++) {
                const entry = scores[i];
                const username = "member" in entry ? entry.member : entry[0];
                const score = "score" in entry ? entry.score : entry[1];
                const displayName = markdownEscape(username);
                const userPageLink = `/r/${subredditName}/wiki/user/${encodeURIComponent(
                    username
                )}`;
                markdown += `| ${
                    i + 1
                } | [${displayName}](${userPageLink}) | ${score}${pointSymbol} |\n`;
            }
        }

        const expiry = expirationFor(timeframe);
        if (expiry) {
            const ttlSeconds = Math.floor((expiry.getTime() - Date.now()) / 1000);
            if (ttlSeconds > 0) {
                await context.redis.expire(redisKey, ttlSeconds);
                logger.debug(`Set Redis expiration for ${title} leaderboard`, {
                    redisKey,
                    ttlSeconds,
                });
            } else {
                logger.warn(`Calculated TTL for ${title} leaderboard is not positive. Skipping expiration.`);
            }
        }
    }

    markdown += `\n\n_Last updated: ${formattedDate} UTC_`;

    const wikiPageOptions = {
        subredditName,
        page: wikiPageName,
        content: markdown,
        reason:
            typeof event.data?.reason === "string"
                ? event.data.reason
                : `Updated ${formattedDate}`,
    };

    let wikiPage: WikiPage | undefined;
    try {
        wikiPage = await context.reddit.getWikiPage(
            subredditName,
            wikiPageName
        );
        logger.info("Fetched existing wiki page.");
    } catch {
        logger.warn("Wiki page does not exist. A new one will be created.");
    }

    if (wikiPage) {
        if (wikiPage.content !== markdown) {
            await context.reddit.updateWikiPage(wikiPageOptions);
            logger.info("Leaderboard wiki page content updated.");
        } else {
            logger.info("Leaderboard content unchanged. Skipping update.");
        }
    } else {
        await context.reddit.createWikiPage(wikiPageOptions);
        logger.info("Leaderboard wiki page created.");
    }

    const correctPermissionLevel =
        leaderboardMode[0] === LeaderboardMode.Public
            ? WikiPagePermissionLevel.SUBREDDIT_PERMISSIONS
            : WikiPagePermissionLevel.MODS_ONLY;

    if (wikiPage) {
        const wikiPageSettings = await wikiPage.getSettings();
        if (wikiPageSettings.permLevel !== correctPermissionLevel) {
            await context.reddit.updateWikiPageSettings({
                subredditName,
                page: wikiPageName,
                listed: true,
                permLevel: correctPermissionLevel,
            });
            logger.info("Leaderboard wiki page permissions updated.", {
                level: correctPermissionLevel,
            });
        } else {
            logger.debug(
                "Wiki page permissions already correct. No change made."
            );
        }
    }

    logger.info("Leaderboard update job completed.");
}

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}
