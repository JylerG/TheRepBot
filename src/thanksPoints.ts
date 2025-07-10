import {
    Context,
    FormOnSubmitEvent,
    JSONObject,
    MenuItemOnPressEvent,
    ScheduledJobEvent,
    SettingsValues,
    TriggerContext,
    User,
} from "@devvit/public-api";
import { CommentSubmit, CommentUpdate } from "@devvit/protos";
import { getSubredditName, isModerator, replaceAll } from "./utility.js";
import { addWeeks, format } from "date-fns";
import {
    ExistingFlairOverwriteHandling,
    AppSetting,
    PointAwardedReplyOptions,
    NotifyOnErrorReplyOptions,
    TemplateDefaults,
} from "./settings.js";
import { setCleanupForUsers } from "./cleanupTasks.js";
import { isLinkId } from "@devvit/shared-types/tid.js";
import { manualSetPointsForm } from "./main.js";
import { LeaderboardMode } from "./settings.js";
import { logger } from "./logger.js";

export const POINTS_STORE_KEY = "thanksPointsStore";
const TIMEFRAMES = ["daily", "weekly", "monthly", "yearly", "alltime"] as const;


function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function formatMessage(
    template: string,
    placeholders: Record<string, string>
): string {
    let result = template;
    for (const [key, value] of Object.entries(placeholders)) {
        const regex = new RegExp(`{{${key}}}`, "g");
        result = result.replace(regex, value);
    }

    const footer =
        "\n\n---\n\n^(I am a bot - please contact the mods with any questions)";
    if (
        !result
            .trim()
            .endsWith(
                "^(I am a bot - please contact the mods with any questions)"
            )
    ) {
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
    // ✅ Store score in Redis
    await context.redis.zAdd(POINTS_STORE_KEY, {
        member: username,
        score: newScore,
    });

    // ✅ Schedule cleanup
    await setCleanupForUsers([username], context);

    // ✅ Schedule leaderboard job
    await context.scheduler.runJob({
        name: "updateLeaderboard",
        runAt: new Date(),
        data: {
            reason: `Awarded a point to ${username}. New score: ${newScore}`,
        },
    });

    // ✅ Flair handling settings
    const flairSetting = (
        (settings[AppSetting.ExistingFlairHandling] as string[] | undefined) ??
        [ExistingFlairOverwriteHandling.OverwriteNumeric]
    )[0] as ExistingFlairOverwriteHandling;

    const shouldSetUserFlair =
        flairSetting !== ExistingFlairOverwriteHandling.NeverSet &&
        (!flairScoreIsNaN ||
            flairSetting === ExistingFlairOverwriteHandling.OverwriteAll);

    if (!shouldSetUserFlair) return;

    // ✅ Read flair styling preferences
    let cssClass = settings[AppSetting.CSSClass] as string | undefined;
    let flairTemplate = settings[AppSetting.FlairTemplate] as string | undefined;

    if (!cssClass) cssClass = undefined;
    if (!flairTemplate) flairTemplate = undefined;
    if (cssClass && flairTemplate) cssClass = undefined; // Template takes priority

    // ✅ Apply symbol if OverwriteNumericSymbol is selected
    const pointSymbol = (settings[AppSetting.PointSymbol] as string) ?? "";
    const flairText =
        flairSetting === ExistingFlairOverwriteHandling.OverwriteNumericSymbol
            ? `${newScore}${pointSymbol}`
            : `${newScore}`;

    const subredditName = await getSubredditName(context);

    await context.reddit.setUserFlair({
        subredditName,
        username,
        cssClass,
        flairTemplateId: flairTemplate,
        text: flairText,
    });
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
    logger.debug("✅ Event triggered", {
        commentId: event.comment?.id,
        postId: event.post?.id,
        author: event.author?.name,
        subreddit: event.subreddit?.name,
    });

    if (!event.comment || !event.post || !event.author || !event.subreddit) {
        logger.warn("❌ Missing comment, post, author, or subreddit");
        return;
    }

    if (isLinkId(event.comment.parentId)) {
        logger.debug("❌ Parent ID is a link — ignoring.");
        return;
    }

    const settings = await context.settings.getAll();

    // Parse command settings first
    const userCommandVal = settings[AppSetting.PointTriggerWords] as string;
    const userCommandList =
        userCommandVal?.split("\n").map((cmd) => cmd.toLowerCase().trim()) ??
        [];
    const modCommand = settings[AppSetting.ModAwardCommand] as
        | string
        | undefined;

    // Combine all trigger commands
    const allCommands = [...userCommandList];
    if (modCommand) allCommands.push(modCommand.toLowerCase().trim());

    const commentBody = event.comment?.body.toLowerCase() ?? "";

    // If author is system (bot or AutoModerator) AND comment contains a command, block it
    const isSystemAuthor =
        event.author.name === context.appName ||
        event.author.name === "AutoModerator";

    const commentContainsCommand = allCommands.some((cmd) =>
        commentBody.includes(cmd)
    );

    if (isSystemAuthor && commentContainsCommand) {
        logger.debug(
            "❌ Author is bot or AutoModerator AND used a command — ignoring.",
            {
                author: event.author.name,
                appName: context.appName,
                commentBody,
                allCommands,
            }
        );
        return;
    }

    const accessControl =
        ((settings[AppSetting.AccessControl] as string[]) ?? [])[0] ??
        "moderators-only";
    const isMod = await isModerator(
        context,
        event.subreddit.name,
        event.author.name
    );
    const approvedUsers = ((settings[AppSetting.SuperUsers] as string) ?? "")
        .split("\n")
        .map((u) => u.trim().toLowerCase())
        .filter(Boolean);
    const isApprovedUser = approvedUsers.includes(
        event.author.name.toLowerCase()
    );
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

    logger.debug("✅ Permission Check", {
        accessControl,
        isMod,
        isApprovedUser,
        isOP,
        hasPermission,
    });

    if (!hasPermission) {
        logger.warn("❌ Author does not have permission");
        return;
    }

    let containsUserCommand = false;
    if (settings[AppSetting.ThanksCommandUsesRegex]) {
        const regexes = userCommandList.map(
            (command) => new RegExp(command, "i")
        );
        containsUserCommand = regexes.some((regex) =>
            event.comment ? regex.test(event.comment.body) : false
        );
    } else {
        containsUserCommand = userCommandList.some((command) =>
            event.comment?.body.toLowerCase().includes(command)
        );
    }

    const containsModCommand =
        modCommand &&
        event.comment.body
            .toLowerCase()
            .includes(modCommand.toLowerCase().trim());

    logger.info("✅ Awarded Comment", {
        commentBody: event.comment.body,
    });

    if (!containsUserCommand && !containsModCommand) {
        return;
    }

    const parentComment = await context.reddit.getCommentById(
        event.comment.parentId
    );
    if (!parentComment) {
        logger.warn("❌ Could not fetch parent comment");
        return;
    }

    if (parentComment.authorName === event.author.name) {
        logger.warn("❌ Author is trying to award themselves");

        const rawNotifyError =
            ((settings[AppSetting.NotifyOnError] as string[]) ?? [])[0] ??
            "none";
        const notifyOnError: NotifyOnErrorReplyOptions = Object.values(
            NotifyOnErrorReplyOptions
        ).includes(rawNotifyError as NotifyOnErrorReplyOptions)
            ? (rawNotifyError as NotifyOnErrorReplyOptions)
            : NotifyOnErrorReplyOptions.NoReply;

        const pointName = (settings[AppSetting.PointName] as string) ?? "point";

        const template =
            (settings[AppSetting.SelfAwardMessage] as string) ??
            TemplateDefaults.NotifyOnSelfAwardTemplate;

        const message = template
            .replace("{{awarder}}", event.author.name)
            .replace("{{name}}", pointName);

        if (notifyOnError === NotifyOnErrorReplyOptions.ReplyByPM) {
            try {
                await context.reddit.sendPrivateMessage({
                    to: event.author.name,
                    subject: `Cannot Award ${pointName}`,
                    text: message,
                });
                logger.info("⚠️ Self-award PM sent");
            } catch (e) {
                logger.warn("❌ Failed to send self-award PM", { e });
            }
        } else if (notifyOnError === NotifyOnErrorReplyOptions.ReplyAsComment) {
            try {
                await context.reddit.submitComment({
                    id: event.comment.id,
                    text: message,
                });
                logger.info("⚠️ Self-award comment sent");
            } catch (e) {
                logger.warn("❌ Failed to send self-award comment", { e });
            }
        }

        return;
    }

    // Check if the awarder has already awarded this specific comment
    const redisKey = `thanks-${parentComment.id}-${event.author.name}`;
    const alreadyAwarded = await context.redis.exists(redisKey);
    if (alreadyAwarded) {
        logger.info(
            "❌ Awarder has already awarded this comment before, ignoring.",
            {
                awarder: event.author.name,
                commentId: parentComment.id,
            }
        );

        const rawNotify =
            ((settings[AppSetting.NotifyOnError] as string[]) ?? [])[0] ??
            "none";
        const notify: NotifyOnErrorReplyOptions = Object.values(
            NotifyOnErrorReplyOptions
        ).includes(rawNotify as NotifyOnErrorReplyOptions)
            ? (rawNotify as NotifyOnErrorReplyOptions)
            : NotifyOnErrorReplyOptions.NoReply;

        const alreadyAwardedMessage = replaceAll(
            (settings[AppSetting.PointAlreadyAwardedMessage] as string) ??
                TemplateDefaults.NotifyOnPointAlreadyAwardedTemplate,
            "{{name}}",
            AppSetting.PointName
        );

        const fallbackMessage = `⚠️ u/${event.author.name}, ${alreadyAwardedMessage}`;

        try {
            if (notify === NotifyOnErrorReplyOptions.ReplyByPM) {
                await context.reddit.sendPrivateMessage({
                    to: event.author.name,
                    subject: `Point Already Awarded in r/${event.subreddit.name}`,
                    text: alreadyAwardedMessage,
                });
                logger.info("⚠️ Already-awarded PM sent");
            } else if (notify === NotifyOnErrorReplyOptions.ReplyAsComment) {
                await context.reddit.submitComment({
                    id: event.comment.id,
                    text: alreadyAwardedMessage,
                });
                logger.info("⚠️ Already-awarded comment reply sent");
            }
        } catch (e) {
            logger.warn(
                "⚠️ Failed to deliver already-awarded notification, trying fallback...",
                { e }
            );

            try {
                if (notify === NotifyOnErrorReplyOptions.ReplyByPM) {
                    await context.reddit.sendPrivateMessage({
                        to: event.author.name,
                        subject: `Point Already Awarded in r/${event.subreddit.name}`,
                        text: fallbackMessage,
                    });
                } else if (
                    notify === NotifyOnErrorReplyOptions.ReplyAsComment
                ) {
                    await context.reddit.submitComment({
                        id: event.comment.id,
                        text: fallbackMessage,
                    });
                }
            } catch (fallbackError) {
                logger.error(
                    "❌ Failed to send fallback notification for already-awarded attempt",
                    {
                        fallbackError,
                    }
                );
            }
        }

        return;
    }

    const parentUser = await parentComment.getAuthor();
    if (!parentUser) {
        logger.warn("❌ Could not fetch parent user");
        return;
    }

    const { currentScore, flairScoreIsNaN } = await getCurrentScore(
        parentUser,
        context,
        settings
    );
    const newScore = currentScore + 1;

    logger.info("✅ Awarding point", {
        awarder: event.author.name,
        awardee: parentComment.authorName,
        previousScore: currentScore,
        newScore,
    });

    await setUserScore(
        parentComment.authorName,
        newScore,
        flairScoreIsNaN,
        context,
        settings
    );

    await context.redis.set(redisKey, Date.now().toString(), {
        expiration: addWeeks(new Date(), 1),
    });
    logger.debug("✅ Redis flag set", { redisKey });

    // Handle notification logic
    const rawNotifySuccess =
        ((settings[AppSetting.NotifyOnSuccess] as string[]) ?? [])[0] ?? "none";
    const notifyAwarded: PointAwardedReplyOptions = Object.values(
        PointAwardedReplyOptions
    ).includes(rawNotifySuccess as PointAwardedReplyOptions)
        ? (rawNotifySuccess as PointAwardedReplyOptions)
        : PointAwardedReplyOptions.NoReply;

    if (notifyAwarded !== PointAwardedReplyOptions.NoReply) {
        const pointName = (settings[AppSetting.PointName] as string) ?? "point";
        const pointSymbol = (settings[AppSetting.PointSymbol] as string) ?? "";
        const successTemplate =
            (settings[AppSetting.SuccessMessage] as string) ??
            "+1 {{name}} awarded to u/{{awardee}} by u/{{awarder}}. Total: {{total}}{{symbol}}. Scoreboard is located [here]({{scoreboard}})";
        const scoreboard = `https://www.reddit.com/r/${
            event.subreddit.name
        }/wiki/${settings[AppSetting.ScoreboardLink] ?? "leaderboard"}`;

        const message = formatMessage(successTemplate, {
            awardee: parentComment.authorName,
            awarder: event.author.name,
            total: newScore.toString(),
            name: pointName,
            symbol: pointSymbol,
            scoreboard,
        });

        const rawNotifyError =
            ((settings[AppSetting.NotifyOnError] as string[]) ?? [])[0] ??
            "none";
        const notifyOnError: NotifyOnErrorReplyOptions = Object.values(
            NotifyOnErrorReplyOptions
        ).includes(rawNotifyError as NotifyOnErrorReplyOptions)
            ? (rawNotifyError as NotifyOnErrorReplyOptions)
            : NotifyOnErrorReplyOptions.NoReply;

        try {
            if (notifyAwarded === PointAwardedReplyOptions.ReplyByPM) {
                await context.reddit.sendPrivateMessage({
                    to: event.author.name,
                    subject: `Point Awarded in r/${event.subreddit.name}`,
                    text: message,
                });
                logger.info(`✅ PM sent to u/${event.author.name}`);
            } else if (
                notifyAwarded === PointAwardedReplyOptions.ReplyAsComment
            ) {
                await context.reddit.submitComment({
                    id: event.comment.id,
                    text: message,
                });

                logger.info(`✅ Comment reply sent to u/${event.author.name}`);
            }
        } catch (err) {
            logger.error("❌ Notification failed", { err });

            const fallback = `⚠️ u/${event.author.name}, we were unable to send your notification.\n\n${message}`;
            try {
                if (notifyOnError === NotifyOnErrorReplyOptions.ReplyByPM) {
                    await context.reddit.sendPrivateMessage({
                        to: event.author.name,
                        subject: "Notification Delivery Failed",
                        text: fallback,
                    });
                    logger.warn("⚠️ Fallback PM sent");
                } else if (
                    notifyOnError === NotifyOnErrorReplyOptions.ReplyAsComment
                ) {
                    await context.reddit.submitComment({
                        id: event.comment.id,
                        text: fallback,
                    });
                    logger.warn("⚠️ Fallback comment sent");
                }
            } catch (e) {
                logger.error("❌ Fallback delivery also failed", { e });
            }
        }
    }

    await updateLeaderboard(
        {
            name: "manual-update",
            data: { reason: "Point awarded" },
        },
        context as unknown as Context
    );
    logger.info("✅ Leaderboard updated");
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
    const settings = await context.settings.getAll();

    // Normalize LeaderboardMode
    const rawMode = settings[AppSetting.LeaderboardMode];
    const leaderboardMode = Array.isArray(rawMode)
        ? rawMode[0]
        : rawMode ?? LeaderboardMode.Off;

    if (leaderboardMode === LeaderboardMode.Off) {
        return;
    }

    const wikiPageName =
        (settings[AppSetting.ScoreboardLink] as string | undefined) ??
        "leaderboards";
    if (!wikiPageName.trim()) {
        return;
    }

    const leaderboardSize =
        (settings[AppSetting.LeaderboardSize] as number) ?? 10;
    const pointName = (settings[AppSetting.PointName] as string) ?? "point";
    const pointSymbol = (settings[AppSetting.PointSymbol] as string) ?? "";

    const subredditName = await getSubredditName(context);
    if (!subredditName) {
        return;
    }

    const now = new Date();
    const formattedDate = format(now, "MM/dd/yyyy HH:mm:ss");

    let markdown = `# ${capitalize(pointName)}boards for r/${subredditName}\n`;

    const helpPage = settings[AppSetting.LeaderboardHelpPage] as
        | string
        | undefined;
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
            logger.error(`Error trying to getTopScores(): ${err}`);
            return [];
        }
    }

    function formatLeaderboardSection(
        title: string,
        entries: { member: string; score: number }[]
    ) {
        let text = `## ${title}\n\n| Rank | User | ${pointName}${
            pointName.endsWith("s") ? "" : "s"
        } ${pointSymbol}|\n|:-|:-|:-:|\n`;
        entries.forEach((entry, i) => {
            text += `| ${i + 1} | u/${entry.member} | ${entry.score} |\n`;
        });
        return text + "\n";
    }

    for (const timeframe of TIMEFRAMES) {
        const entries = await getTopScores(
            leaderboardKey(timeframe),
            leaderboardSize
        );
        const title =
            timeframe[0].toUpperCase() + timeframe.slice(1) + " Leaderboard";
        markdown += formatLeaderboardSection(title, entries);
    }

    try {
        await context.reddit.updateWikiPage({
            subredditName,
            page: wikiPageName,
            content: markdown,
            reason: `Automated leaderboard update at ${formattedDate}`,
        });
    } catch (error) {
        logger.error(`Error trying to update ${wikiPageName}: ${error}`);
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