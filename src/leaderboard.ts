import {
    ScheduledJobEvent,
    JobContext,
    WikiPagePermissionLevel,
    JSONObject,
    WikiPage,
} from "@devvit/public-api";
import { format,  } from "date-fns";
import { AppSetting, LeaderboardMode, TemplateDefaults } from "./settings.js";
import { getSubredditName } from "./utility.js";
import pluralize from "pluralize";

export const TIMEFRAMES = [
    "alltime",
] as const;

const POINTS_STORE_KEY = "thanksPointsStore";

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function markdownEscape(input: string): string {
    return input.replace(/([\\`*_{}\[\]()#+\-.!])/g, "\\$1");
}

export async function updateLeaderboard (event: ScheduledJobEvent<JSONObject | undefined>, context: JobContext) {
    const settings = await context.settings.getAll();

    const leaderboardMode = settings[AppSetting.LeaderboardMode] as string[] | undefined;
    if (!leaderboardMode || leaderboardMode.length === 0 || leaderboardMode[0] as LeaderboardMode === LeaderboardMode.Off) {
        return;
    }

    const wikiPageName = settings[AppSetting.ScoreboardName] as string | undefined;
    if (!wikiPageName) {
        return;
    }

    const leaderboardSize = settings[AppSetting.LeaderboardSize] as number | undefined ?? 20;

    const highScores = await context.redis.zRange(POINTS_STORE_KEY, 0, leaderboardSize - 1, { by: "rank", reverse: true });

    const subredditName = await getSubredditName(context);

    const pointName = settings[AppSetting.PointName] as string ?? "point";
    
    const helpPage = settings[AppSetting.PointSystemHelpPage] as string | undefined;
    
    let wikiContents = "";
    if (helpPage) {
        wikiContents += `# ${capitalize(pointName)}board for ${subredditName}\n\n[How to award points on /r/${subredditName}](${helpPage})\n\nUser | ${capitalize(pointName)}s Earned\n-|-\n`;
    } else {
        wikiContents += `# ${capitalize(pointName)}board for ${subredditName}\n\nUser | ${capitalize(pointName)}s Earned\n-|-\n`;
    }
    
    
    wikiContents += highScores.map(score => `${markdownEscape(score.member)}|${score.score}`).join("\n");

    wikiContents += `\n\nThe leaderboard shows the top ${leaderboardSize} ${pluralize("user", leaderboardSize)} who ${pluralize("has", leaderboardSize)} been awarded at least one point`;

    const installDateTimestamp = await context.redis.get("InstallDate");
    if (installDateTimestamp) {
        const installDate = new Date(parseInt(installDateTimestamp));
        wikiContents += ` since ${installDate.toUTCString()}`;
    }

    wikiContents += ".";

    

    let wikiPage: WikiPage | undefined;
    try {
        wikiPage = await context.reddit.getWikiPage(subredditName, wikiPageName);
    } catch {
        //
    }

    const wikiPageOptions = {
        subredditName,
        page: wikiPageName,
        content: wikiContents,
        reason: event.data?.reason as string | undefined,
    };

    if (wikiPage) {
        if (wikiPage.content !== wikiContents) {
            await context.reddit.updateWikiPage(wikiPageOptions);
            console.log("Leaderboard: Leaderboard updated.");
        }
    } else {
        wikiPage = await context.reddit.createWikiPage(wikiPageOptions);
        console.log("Leaderboard: Leaderboard created.");
    }

    const correctPermissionLevel = leaderboardMode[0] as LeaderboardMode === LeaderboardMode.Public ? WikiPagePermissionLevel.SUBREDDIT_PERMISSIONS : WikiPagePermissionLevel.MODS_ONLY;

    const wikiPageSettings = await wikiPage.getSettings();
    if (wikiPageSettings.permLevel !== correctPermissionLevel) {
        await context.reddit.updateWikiPageSettings({
            subredditName,
            page: wikiPageName,
            listed: true,
            permLevel: correctPermissionLevel,
        });
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