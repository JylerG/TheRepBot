import { Context, FormOnSubmitEvent, JSONObject, MenuItemOnPressEvent, ScheduledJobEvent, SettingsValues, TriggerContext, User } from "@devvit/public-api";
import { CommentSubmit, CommentUpdate } from "@devvit/protos";
import { getSubredditName, isModerator, replaceAll } from "./utility.js";
import { addWeeks, format } from "date-fns";

import { ExistingFlairOverwriteHandling, AppSetting, PointAwardedReplyOptions } from "./settings.js";
import markdownEscape from "markdown-escape";
import { setCleanupForUsers } from "./cleanupTasks.js";
import { isLinkId } from "@devvit/shared-types/tid.js";
import { manualSetPointsForm } from "./main.js";
import { LeaderboardMode } from "./settings.js";
import { logger } from "./logger.js"; // Assuming you have a logger module

export const POINTS_STORE_KEY = "thanksPointsStore";
const TIMEFRAMES = ["daily", "weekly", "monthly", "yearly", "alltime"] as const;

function formatMessage(
    template: string,
    placeholders: Record<string, string>
): string {
    let result = template;
    for (const [key, value] of Object.entries(placeholders)) {
        const regex = new RegExp(`{{${key}}}`, "g");
        result = result.replace(regex, value);
    }

    const footer = "\n\n---\n\n^(I am a bot - please contact the mods with any questions)";
    if (!result.trim().endsWith("^(I am a bot - please contact the mods with any questions)")) {
        result = result.trim() + footer;
    }

    return result;
}


async function getCurrentScore(
    user: User,
    context: TriggerContext,
    settings: SettingsValues
): Promise<{ currentScore: number; flairScoreIsNaN: boolean }> {
    const subredditName = await getSubredditName(context);
    const userFlair = await user.getUserFlairBySubreddit(subredditName);

    let scoreFromRedis: number | undefined;
    try {
        scoreFromRedis =
            (await context.redis.zScore(POINTS_STORE_KEY, user.username)) ?? 0;
    } catch {
        scoreFromRedis = 0;
    }

    let scoreFromFlair: number;
    const numberRegex = /^\d+$/;

    if (!userFlair?.flairText || userFlair.flairText === "-") {
        scoreFromFlair = 0;
    } else if (!numberRegex.test(userFlair.flairText)) {
        scoreFromFlair = NaN;
    } else {
        scoreFromFlair = parseInt(userFlair.flairText);
    }

    const flairScoreIsNaN = isNaN(scoreFromFlair);

    if (settings[AppSetting.PrioritiseScoreFromFlair] && !flairScoreIsNaN) {
        return { currentScore: scoreFromFlair, flairScoreIsNaN };
    }

    return {
        currentScore:
            !flairScoreIsNaN && scoreFromFlair > scoreFromRedis
                ? scoreFromFlair
                : scoreFromRedis,
        flairScoreIsNaN,
    };
}

async function setUserScore(
    username: string,
    newScore: number,
    flairScoreIsNaN: boolean,
    context: TriggerContext,
    settings: SettingsValues
) {
    // Store the user's new score in Redis sorted set
    await context.redis.zAdd(POINTS_STORE_KEY, {
        member: username,
        score: newScore,
    });
    logger.info(`Score updated for ${username}: ${newScore}`);

    // Queue user for cleanup checks in 24 hours
    await setCleanupForUsers([username], context);

    // Queue a leaderboard update job
    await context.scheduler.runJob({
        name: "updateLeaderboard",
        runAt: new Date(),
        data: {
            reason: `Awarded a point to ${username}. New score: ${newScore}`,
        },
    });

    // Handle flair updating according to settings
    const existingFlairOverwriteHandling = ((settings[
        AppSetting.ExistingFlairHandling
    ] as string[] | undefined) ?? [
        ExistingFlairOverwriteHandling.OverwriteNumeric,
    ])[0] as ExistingFlairOverwriteHandling;

    const shouldSetUserFlair =
        existingFlairOverwriteHandling !==
            ExistingFlairOverwriteHandling.NeverSet &&
        (!flairScoreIsNaN ||
            existingFlairOverwriteHandling ===
                ExistingFlairOverwriteHandling.OverwriteAll);

    if (shouldSetUserFlair) {
        logger.info(`Setting flair for ${username} to ${newScore}`);

        let cssClass = settings[AppSetting.CSSClass] as string | undefined;
        if (!cssClass) cssClass = undefined;

        let flairTemplate = settings[AppSetting.FlairTemplate] as
            | string
            | undefined;
        if (!flairTemplate) flairTemplate = undefined;

        if (flairTemplate && cssClass) {
            // Prioritize flair template over CSS class
            cssClass = undefined;
        }

        const subredditName = await getSubredditName(context);

        await context.reddit.setUserFlair({
            subredditName,
            username,
            cssClass,
            flairTemplateId: flairTemplate,
            text: newScore.toString(),
        });
    } else {
        logger.info(
            `${username}: Flair not set due to settings or flair state.`
        );
    }
}

async function getUserIsSuperuser(
    username: string,
    context: TriggerContext
): Promise<boolean> {
    const settings = await context.settings.getAll();

    const superUserSetting =
        (settings[AppSetting.SuperUsers] as string | undefined) ?? "";
    const superUsers = superUserSetting
        .split(",")
        .map((user) => user.trim().toLowerCase());

    if (superUsers.includes(username.toLowerCase())) {
        return true;
    }

    const autoSuperuserThreshold =
        (settings[AppSetting.AutoSuperuserThreshold] as number | undefined) ??
        0;

    if (autoSuperuserThreshold) {
        let user: User | undefined;
        try {
            user = await context.reddit.getUserByUsername(username);
        } catch {
            return false;
        }
        if (!user) {
            return false;
        }
        const { currentScore } = await getCurrentScore(user, context, settings);
        return currentScore >= autoSuperuserThreshold;
    } else {
        return false;
    }
}

export async function handleThanksEvent(
  event: CommentSubmit | CommentUpdate,
  context: TriggerContext
) {
  if (!event.comment || !event.post || !event.author || !event.subreddit) return;

  logger.debug("handleThanksEvent triggered", {
    commentId: event.comment.id,
    commentBody: event.comment.body,
    postId: event.post.id,
    authorName: event.author.name,
    subreddit: event.subreddit.name,
  });

  if (isLinkId(event.comment.parentId)) return;

  if (
    event.author.name === context.appName ||
    event.author.name === "AutoModerator"
  ) return;

  const settings = await context.settings.getAll();

  const accessControl = (settings[AppSetting.AccessControl] as string[] ?? [])[0] ?? "moderators-only";
  const isMod = await isModerator(context, event.subreddit.name, event.author.name);
  const approvedUsers = (settings[AppSetting.SuperUsers] as string ?? "")
    .split("\n")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  const isApprovedUser = approvedUsers.includes(event.author.name.toLowerCase());
  const isOP = event.author.id === event.post.authorId;

  let hasPermission = false;
  switch (accessControl) {
    case "everyone":
      hasPermission = true;
      break;
    case "moderators-only":
      hasPermission = isMod;
      break;
    case "moderators-and-approved-users":
      hasPermission = isMod || isApprovedUser;
      break;
    case "moderators-approved-and-op":
      hasPermission = isMod || isApprovedUser || isOP;
      break;
  }

  if (!hasPermission) {
    logger.debug("User lacks permission to award", { accessControl, isMod, isApprovedUser, isOP });
    return;
  }

  const userCommandVal = settings[AppSetting.PointTriggerWords] as string | undefined;
  const userCommandList = userCommandVal?.split("\n").map((cmd) => cmd.toLowerCase().trim()) ?? [];
  const modCommand = settings[AppSetting.ModAwardCommand] as string | undefined;

  let containsUserCommand: boolean;
  if (settings[AppSetting.ThanksCommandUsesRegex]) {
    const regexes = userCommandList.map((command) => new RegExp(command, "i"));
    containsUserCommand = regexes.some((regex) => regex.test(event.comment?.body ?? ""));
  } else {
    containsUserCommand = userCommandList.some((command) =>
      event.comment?.body.toLowerCase().includes(command)
    );
  }

  const containsModCommand =
    modCommand &&
    event.comment.body.toLowerCase().includes(modCommand.toLowerCase().trim());

  logger.debug("Command matching result", {
    userCommandVal,
    userCommandList,
    modCommand,
    containsUserCommand,
    containsModCommand,
  });

  if (!containsUserCommand && !containsModCommand) return;

  const parentComment = await context.reddit.getCommentById(event.comment.parentId);
  if (!parentComment || parentComment.authorName === event.author.name) return;

  const parentUser = await parentComment.getAuthor();
  if (!parentUser) return;

  const { currentScore, flairScoreIsNaN } = await getCurrentScore(parentUser, context, settings);
  const newScore = currentScore + 1;

  logger.debug("Score update about to happen", {
    username: parentComment.authorName,
    currentScore,
    newScore,
    flairScoreIsNaN,
  });

  await setUserScore(parentComment.authorName, newScore, flairScoreIsNaN, context, settings);

  await context.redis.set(`thanks-${parentComment.id}-${event.author.name}`, Date.now().toString(), {
    expiration: addWeeks(new Date(), 1),
  });

  const rawNotifySetting = (settings[AppSetting.NotifyOnSuccess] as string[] ?? [])[0] ?? "none";

  const notify: PointAwardedReplyOptions = Object.values(PointAwardedReplyOptions).includes(
    rawNotifySetting as PointAwardedReplyOptions
  )
    ? (rawNotifySetting as PointAwardedReplyOptions)
    : PointAwardedReplyOptions.NoReply;

  if (notify !== PointAwardedReplyOptions.NoReply) {
    const scoreboardLink = settings[AppSetting.ScoreboardLink] as string | undefined;
    const pointName = settings[AppSetting.PointName] as string ?? "point";
    const pointSymbol = settings[AppSetting.PointSymbol] as string ?? "";
    const successTemplate = settings[AppSetting.SuccessMessage] as string ?? 
      "+1 {{name}} awarded to u/{{awardee}} by u/{{awarder}}. Total: {{total}}{{symbol}}. Scoreboard is located [here]({{scoreboard}})";

    const scoreboard = `https://www.reddit.com/r/${event.subreddit.name}/wiki/${scoreboardLink ?? "leaderboard"}`;

    const message = formatMessage(successTemplate, {
      awardee: parentComment.authorName,
      awarder: event.author.name,
      total: newScore.toString(),
      name: pointName,
      symbol: pointSymbol,
      scoreboard,
    });

    logger.debug("Sending user notification", {
      notify,
      awarder: event.author.name,
      awardee: parentComment.authorName,
      message,
    });

    if (notify === PointAwardedReplyOptions.ReplyByPM) {
      try {
        await context.reddit.sendPrivateMessage({
          to: event.author.name,
          subject: `Point Awarded in r/${event.subreddit.name}`,
          text: message,
        });
        logger.info(`PM sent to ${event.author.name}`);
      } catch (err) {
        logger.warn(`Failed to send PM to ${event.author.name}`, { err });
      }
    } else if (notify === PointAwardedReplyOptions.ReplyAsComment) {
      await context.reddit.submitComment({
        id: event.comment.id,
        text: message,
      });
      logger.info(`Comment reply sent to ${event.author.name}`);
    }
  }

  await updateLeaderboard(
    {
      name: "manual-update",
      data: { reason: "Point awarded" },
    },
    context as unknown as Context
  );
}

function leaderboardKey(timeframe: string): string {
    return timeframe === "alltime"
        ? POINTS_STORE_KEY
        : `thanksPointsStore:${timeframe}`;
}

function expirationFor(timeframe: string): Date {
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
            const dayOfWeek = utcNow.getUTCDay();
            const daysUntilMonday = (8 - dayOfWeek) % 7 || 7;
            const nextMonday = new Date(utcNow);
            nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilMonday);
            nextMonday.setUTCHours(0, 0, 0, 0);
            return nextMonday;
        }
        case "monthly": {
            return new Date(
                Date.UTC(utcNow.getUTCFullYear(), utcNow.getUTCMonth() + 1, 1)
            );
        }
        case "yearly": {
            return new Date(Date.UTC(utcNow.getUTCFullYear() + 1, 0, 1));
        }
        default:
            throw new Error(`Invalid timeframe: ${timeframe}`);
    }
}

export async function updateLeaderboard(
  event: ScheduledJobEvent<JSONObject | undefined>,
  context: Context
) {
  logger.info("Leaderboard update job started.");

  const settings = await context.settings.getAll();
  logger.debug("Leaderboard: Settings loaded", settings);

  // Normalize LeaderboardMode
  const rawMode = settings[AppSetting.LeaderboardMode];
  const leaderboardMode = Array.isArray(rawMode) ? rawMode[0] : rawMode ?? LeaderboardMode.Off;

  if (leaderboardMode === LeaderboardMode.Off) {
    logger.info("Leaderboard mode is OFF. Exiting.");
    return;
  }

  const wikiPageName = (settings[AppSetting.ScoreboardLink] as string | undefined) ?? "leaderboards";
  if (!wikiPageName.trim()) {
    logger.warn("No wiki page name configured. Exiting.");
    return;
  }

  const leaderboardSize = (settings[AppSetting.LeaderboardSize] as number) ?? 10;
  const pointName = (settings[AppSetting.PointName] as string) ?? "point";
  const pointSymbol = (settings[AppSetting.PointSymbol] as string) ?? "";

  const subredditName = await getSubredditName(context);
  if (!subredditName) {
    logger.error("Could not determine subreddit name.");
    return;
  }

  const now = new Date();
  const formattedDate = format(now, "MM/dd/yyyy HH:mm:ss");
  logger.debug("Updating leaderboard", { subredditName, formattedDate });

  let markdown = `# Leaderboards for r/${subredditName}\n`;

  const helpPage = settings[AppSetting.LeaderboardHelpPage] as string | undefined;
  if (helpPage?.trim()) {
    markdown += `*See [how the ${pointName}s system works](https://www.reddit.com/r/${subredditName}/wiki/${helpPage})*\n\n`;
  }

  async function getTopScores(key: string, size: number) {
    try {
      const zRangeResults = await context.redis.zRange(key, 0, size - 1, {
        reverse: true,
        by: "score",
      });

      return zRangeResults.map((r) => ({
        member: r.member,
        score: r.score,
      }));
    } catch (err) {
      logger.error(`Failed to fetch scores for ${key}`, { err });
      return [];
    }
  }

  function formatLeaderboardSection(
    title: string,
    entries: { member: string; score: number }[]
  ) {
    let text = `## ${title}\n\n| Rank | User | ${pointName}${pointName.endsWith("s") ? "" : "s"} ${pointSymbol}|\n|:-|:-|:-:|\n`;
    entries.forEach((entry, i) => {
      text += `| ${i + 1} | u/${entry.member} | ${entry.score} |\n`;
    });
    return text + "\n";
  }

  for (const timeframe of TIMEFRAMES) {
    const entries = await getTopScores(leaderboardKey(timeframe), leaderboardSize);
    const title = timeframe[0].toUpperCase() + timeframe.slice(1) + " Leaderboard";
    markdown += formatLeaderboardSection(title, entries);
  }

  try {
    await context.reddit.updateWikiPage({
      subredditName,
      page: wikiPageName,
      content: markdown,
      reason: `Automated leaderboard update at ${formattedDate}`,
    });
    logger.info("Leaderboard updated successfully.");
  } catch (error) {
    logger.error("Failed to update leaderboard wiki page:", { error });
  }
}

export async function handleManualPointSetting(
    event: MenuItemOnPressEvent,
    context: Context
) {
    const comment = await context.reddit.getCommentById(event.targetId);
    let user: User | undefined;
    try {
        user = await context.reddit.getUserByUsername(comment.authorName);
    } catch {
        //
    }

    if (!user) {
        context.ui.showToast("Cannot set points. User may be shadowbanned.");
        return;
    }

    const settings = await context.settings.getAll();
    const { currentScore } = await getCurrentScore(user, context, settings);

    const fields = [
        {
            name: "newScore",
            type: "number",
            defaultValue: currentScore,
            label: `Enter a new score for ${comment.authorName}`,
            helpText:
                "Warning: This will overwrite the score that currently exists",
            multiSelect: false,
            required: true,
        },
    ];

    context.ui.showForm(manualSetPointsForm, { fields });
}

export async function manualSetPointsFormHandler(
    event: FormOnSubmitEvent<JSONObject>,
    context: Context
) {
    if (!context.commentId) {
        context.ui.showToast("An error occurred setting the user's score.");
        return;
    }

    const newScore = event.values.newScore as number | undefined;
    if (!newScore) {
        context.ui.showToast("You must enter a new score");
        return;
    }

    const comment = await context.reddit.getCommentById(context.commentId);

    let user: User | undefined;
    try {
        user = await context.reddit.getUserByUsername(comment.authorName);
    } catch {
        //
    }

    if (!user) {
        context.ui.showToast("Cannot set points. User may be shadowbanned.");
        return;
    }

    const settings = await context.settings.getAll();

    const { flairScoreIsNaN } = await getCurrentScore(user, context, settings);
    await setUserScore(
        comment.authorName,
        newScore,
        flairScoreIsNaN,
        context,
        settings
    );

    context.ui.showToast(`Score for ${comment.authorName} is now ${newScore}`);
}
