import {
    ScheduledJobEvent,
    JobContext,
    WikiPagePermissionLevel,
    JSONObject,
} from "@devvit/public-api";
import { format,  } from "date-fns";
import { AppSetting, LeaderboardMode, TemplateDefaults } from "./settings.js";
import { getSubredditName } from "./utility.js";
import { logger } from "./logger.js";

export const TIMEFRAMES = [
    "alltime",
] as const;

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function markdownEscape(input: string): string {
    return input.replace(/([\\`*_{}\[\]()#+\-.!])/g, "\\$1");
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
        (settings[AppSetting.ScoreboardName] as string) ?? "leaderboard";
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

    // Fetch the all-time leaderboard entries
    const redisKey = `thanksPointsStore:${subredditName}:alltime`;
    const { markdown: tableMarkdown, scores } =
        await buildOrUpdateLeaderboard(
            context,
            subredditName,
            redisKey,
            pointName,
            pointSymbol,
            leaderboardSize
        );

    markdown += `\n\n${tableMarkdown}`;
    scores.push(...scores);

    // --- Wiki update + logging ---
    let wikiUpdated = false;
    let permissionsUpdated = false;

    try {
        const wikiPage = await context.reddit.getWikiPage(
            subredditName,
            wikiPageName
        );

        const oldText = wikiPage.content;
        const newText = markdown;

        if (oldText !== newText) {
            await context.reddit.updateWikiPage({
                subredditName,
                page: wikiPageName,
                content: newText,
                reason: `Updated ${formattedDate}`,
            });
            wikiUpdated = true;

            // Truncate texts for logging
            const maxLen = 200;
            const truncatedOld =
                oldText.length > maxLen
                    ? oldText.slice(0, maxLen) + "..."
                    : oldText;
            const truncatedNew =
                newText.length > maxLen
                    ? newText.slice(0, maxLen) + "..."
                    : newText;

            logger.info(
                `✅ Wiki page content updated on r/${subredditName}/${wikiPageName}`,
                {
                    oldText: truncatedOld,
                    newText: truncatedNew,
                }
            );
        }

        const wikiSettings = await wikiPage.getSettings();
        if (wikiSettings.permLevel !== correctPermissionLevel) {
            await context.reddit.updateWikiPageSettings({
                subredditName,
                page: wikiPageName,
                listed: true,
                permLevel: correctPermissionLevel,
            });
            permissionsUpdated = true;
            logger.info(
                `✅ Wiki page permission level updated to ${correctPermissionLevel} on r/${subredditName}/${wikiPageName}`
            );
        }

        if (!wikiUpdated && !permissionsUpdated) {
            logger.info(
                `ℹ️ Wiki page on r/${subredditName}/${wikiPageName} is already up-to-date.`
            );
        }
    } catch (e) {
        // Wiki page does not exist, create it fresh
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
        wikiUpdated = true;
        permissionsUpdated = true;
        logger.info(
            `✅ Wiki page created and permissions set on r/${subredditName}/${wikiPageName}`
        );
    }
}

export async function buildOrUpdateLeaderboard(
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

    // logger.debug("📊 AllTime Leaderboard Fetched", {
    //     timeframe: "alltime",
    //     redisKey,
    //     scoresPreview: scores.slice(0, 10),
    //     totalScores: scores.length,
    // });

    let markdown = `| Rank | User | ${capitalize(pointName)}${
        pointName.endsWith("s") ? "" : "s"
    } |\n|------|------|---------|\n`;

    if (scores.length === 0) {
        markdown += `| – | No data yet | – |\n`;
    } else {
        for (let i = 0; i < scores.length; i++) {
            const { member, score } = scores[i];
            const safeMember = markdownEscape(member);
            // const userWikiLink = `/r/${subredditName}/wiki/user/${encodeURIComponent(
            //     member
            // )}`;
            markdown += `| ${
                i + 1
            } | ${safeMember} | ${score}${pointSymbol} |\n`;
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