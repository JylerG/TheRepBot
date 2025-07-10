import {
    ScheduledJobEvent,
    JobContext,
    WikiPagePermissionLevel,
    JSONObject,
} from "@devvit/public-api";
import { format } from "date-fns";
import { AppSetting, LeaderboardMode, TemplateDefaults } from "./settings.js";
import { getSubredditName } from "./utility.js";
import { logger } from "./logger.js";

const TIMEFRAMES = ["daily", "weekly", "monthly", "yearly", "alltime"] as const;

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

async function seedTimeframesFromAllTime(context: JobContext) {
    const allTimeKey = leaderboardKey("alltime");
    const allTimeScores = await context.redis.zRange(allTimeKey, 0, -1, {
        by: "score",
    });

    if (!allTimeScores.length) {
        logger.info("No all-time data to seed other timeframes.");
        return;
    }

    for (const timeframe of TIMEFRAMES) {
        if (timeframe === "alltime") continue;

        const key = leaderboardKey(timeframe);
        const existingCount = await context.redis.zCard(key);
        if (existingCount > 0) {
            logger.info(
                `Skipping seeding ${timeframe} leaderboard; already has ${existingCount} entries.`
            );
            continue;
        }

        for (const entry of allTimeScores) {
            await context.redis.zIncrBy(key, entry.member, entry.score);
        }

        const expiry = expirationFor(timeframe);
        if (expiry) {
            const ttl = Math.floor((expiry.getTime() - Date.now()) / 1000);
            if (ttl > 0) await context.redis.expire(key, ttl);
        }

        logger.info(
            `Seeded ${timeframe} leaderboard from all-time with ${allTimeScores.length} entries.`
        );
    }
}

export async function updateLeaderboard(
  event: ScheduledJobEvent<JSONObject | undefined>,
  context: JobContext
) {
  const settings = await context.settings.getAll();
  const leaderboardMode = settings[AppSetting.LeaderboardMode] as string[] | undefined;
  if (!leaderboardMode || leaderboardMode[0] === LeaderboardMode.Off) return;

  await seedTimeframesFromAllTime(context);

  const wikiPageName = (settings[AppSetting.ScoreboardLink] as string) ?? "leaderboards";
  if (!wikiPageName.trim()) return;

  const leaderboardSize = (settings[AppSetting.LeaderboardSize] as number) ?? 10;
  const pointName = (settings[AppSetting.PointName] as string) ?? "point";
  const pointSymbol = (settings[AppSetting.PointSymbol] as string) ?? "";
  const subredditName = await getSubredditName(context);
  if (!subredditName) return;

  const formattedDate = format(new Date(), "MM/dd/yyyy HH:mm:ss");
  let markdown = `# ${capitalize(pointName)}boards for r/${subredditName}\n`;

  const helpPage = settings[AppSetting.LeaderboardHelpPage] as string | undefined;
  const helpMessageTemplate = TemplateDefaults.LeaderboardHelpPageMessage as string;
  if (helpPage?.trim()) {
    markdown += `${helpMessageTemplate.replace("{{help}}", helpPage)}\n\n`;
  }

  const correctPermissionLevel =
    leaderboardMode[0] === LeaderboardMode.Public
      ? WikiPagePermissionLevel.SUBREDDIT_PERMISSIONS
      : WikiPagePermissionLevel.MODS_ONLY;

  const onlyShowAllTime =
    (settings[AppSetting.OnlyShowAllTimeScoreboard] as string[] | undefined)?.[0] === "true";

  for (const timeframe of TIMEFRAMES) {
    if (onlyShowAllTime && timeframe !== "alltime") continue;

    const redisKey = leaderboardKey(timeframe);
    const title = timeframe === "alltime" ? "" : capitalize(timeframe);

    if (title !== "") {
        markdown += `\n\n## ${title}\n`;
        continue;
    }

    const { markdown: tableMarkdown, scores } = await buildOrUpdateLeaderboard(
      context,
      subredditName,
      redisKey,
      pointName,
      pointSymbol,
      leaderboardSize
    );

    markdown += tableMarkdown;

    // Build or update user pages for all scores in this timeframe
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

    // Set Redis key expiration if applicable
    const expiry = expirationFor(timeframe);
    if (expiry) {
      const ttl = Math.floor((expiry.getTime() - Date.now()) / 1000);
      if (ttl > 0) {
        await context.redis.expire(redisKey, ttl);
      }
    }
  }

  markdown += `\n\nLast updated: ${formattedDate} UTC`;

  try {
    const wikiPage = await context.reddit.getWikiPage(subredditName, wikiPageName);
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

    userPageContent += `\n_Last updated: ${formattedDate} UTC_`;

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

export async function buildOrUpdateLeaderboard(
  context: JobContext,
  subredditName: string,
  redisKey: string,
  pointName: string,
  pointSymbol: string,
  leaderboardSize: number
): Promise<{ markdown: string; scores: { member: string; score: number }[] }> {
  // Use zRangeWithScores to get both member and score
  const scores = await context.redis.zRange(redisKey, 0, leaderboardSize - 1, {
    by: "score",
  });

  let markdown = `| Rank | User | ${capitalize(pointName)}${pointName.endsWith("s") ? "" : "s"} |\n|------|------|---------|\n`;

  if (scores.length === 0) {
    markdown += `| – | No data yet | – |\n`;
  } else {
    for (let i = 0; i < scores.length; i++) {
      const { member, score } = scores[i];
      const userWikiLink = `/r/${subredditName}/wiki/user/${encodeURIComponent(member)}`;
      markdown += `| ${i + 1} | [${member}](${userWikiLink}) | ${score}${pointSymbol} |\n`;
    }
  }

  return { markdown, scores };
}