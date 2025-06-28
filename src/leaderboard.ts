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
import { format } from "date-fns";

const TIMEFRAMES = ["daily", "weekly", "monthly", "yearly", "alltime"] as const;

function leaderboardKey(timeframe: string): string {
  return timeframe === "alltime" ? "thanksPointsStore" : `thanksPointsStore:${timeframe}`;
}

export async function updateLeaderboard(
  event: ScheduledJobEvent<JSONObject | undefined>,
  context: JobContext
) {
  const settings = await context.settings.getAll();

  const leaderboardMode = settings[AppSetting.LeaderboardMode] as string[] | undefined;
  if (
    !leaderboardMode ||
    leaderboardMode.length === 0 ||
    leaderboardMode[0] === LeaderboardMode.Off
  ) {
    console.log("Leaderboard: Disabled via settings.");
    return;
  }

  const wikiPageName = settings[AppSetting.LeaderboardWikiPage] as string | undefined;
  if (!wikiPageName) {
    console.log("Leaderboard: No wiki page name set.");
    return;
  }

  const leaderboardSize = (settings[AppSetting.LeaderboardSize] as number) ?? 20;
  const pointName = (settings[AppSetting.PointName] as string) ?? "point";
  const pointSymbol = (settings[AppSetting.PointSymbol] as string) ?? "";

  const subredditName = await getSubredditName(context);
  if (!subredditName) {
    console.error("Leaderboard: Could not determine subreddit name.");
    return;
  }

  const now = new Date();
  const formattedDate = format(now, "MM/dd/yyyy HH:mm:ss");

  // Compose leaderboard markdown for all timeframes
  let markdown = `# Leaderboards for r/${subredditName}\n_Last updated: ${formattedDate}_\n`;

  for (const timeframe of TIMEFRAMES) {
    const redisKey = leaderboardKey(timeframe);
    const scores = await context.redis.zRange(redisKey, 0, leaderboardSize - 1);

    if (!scores.length) {
      console.log(`Leaderboard: No scores found for timeframe ${timeframe}`);
      continue;
    }

    markdown += `\n\n## ${subredditName} Leaderboard\n`;
    markdown += `| Rank | User | ${capitalize(pointName)}${pluralize("", scores.length)} |\n`;
    markdown += `|-------|------|---------|\n`;

    for (let i = 0; i < scores.length; i++) {
      const entry = scores[i];
      // zRange returns array of { member, score } objects or strings, depending on Redis lib version
      // Assuming your Redis client returns objects with member and score props:
      const username = "member" in entry ? entry.member : entry[0];
      const score = "score" in entry ? entry.score : entry[1];
      const displayName = markdownEscape(username);
      const userPageLink = `/r/${subredditName}/wiki/user/${encodeURIComponent(username)}`;
      markdown += `| ${i + 1} | [${displayName}](${userPageLink}) | ${score}${pointSymbol} |\n`;
    }
  }

  let wikiPage: WikiPage | undefined;
  try {
    wikiPage = await context.reddit.getWikiPage(subredditName, wikiPageName);
  } catch {
    // Page does not exist or error fetching
  }

  const wikiPageOptions = {
    subredditName,
    page: wikiPageName,
    content: markdown,
    reason: typeof event.data?.reason === "string"
      ? event.data.reason
      : `Updated leaderboard on ${formattedDate}`,
  };

  if (wikiPage) {
    if (wikiPage.content !== markdown) {
      await context.reddit.updateWikiPage(wikiPageOptions);
      console.log("Leaderboard: Leaderboard updated.");
    } else {
      console.log("Leaderboard: No changes to leaderboard content.");
    }
  } else {
    await context.reddit.createWikiPage(wikiPageOptions);
    console.log("Leaderboard: Leaderboard created.");
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
      console.log(`Leaderboard: Updated wiki page permission to ${correctPermissionLevel}.`);
    }
  }
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
