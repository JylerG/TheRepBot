import {
    Context,
    FormOnSubmitEvent,
    JSONObject,
    MenuItemOnPressEvent,
    SettingsValues,
    TriggerContext,
    User,
} from "@devvit/public-api";
import { CommentSubmit, CommentUpdate } from "@devvit/protos";
import { getSubredditName, isModerator } from "./utility.js";
import {
    ExistingFlairOverwriteHandling,
    AppSetting,
    TemplateDefaults,
    NotifyOnSuccessReplyOptions,
    NotifyOnSelfAwardReplyOptions,
    NotifyOnPointAlreadyAwardedReplyOptions,
} from "./settings.js";
import { setCleanupForUsers } from "./cleanupTasks.js";
import { isLinkId } from "@devvit/shared-types/tid.js";
import { manualSetPointsForm } from "./main.js";
import { logger } from "./logger.js";

const POINTS_STORE_KEY = "thanksPointsStore";

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
): Promise<{
    currentScore: number;
    flairScoreIsNaN: boolean;
    flairText: string;
    flairSymbol: string;
}> {
    const subredditName = await getSubredditName(context);
    const userFlair = await user.getUserFlairBySubreddit(subredditName);

    let scoreFromRedis: number | undefined;
    try {
        scoreFromRedis =
            (await context.redis.zScore(
                `${POINTS_STORE_KEY}`,
                user.username
            )) ?? 0;
    } catch {
        scoreFromRedis = 0;
    }

    const flairTextRaw = userFlair?.flairText ?? "";
    let scoreFromFlair: number;
    const numberRegex = /^\d+$/;

    if (!flairTextRaw || flairTextRaw === "-") {
        scoreFromFlair = 0;
    } else {
        // Extract numeric part from start of flair text (e.g. "17⭐" -> "17")
        const numericMatch = flairTextRaw.match(/^\d+/);
        if (numericMatch && numberRegex.test(numericMatch[0])) {
            scoreFromFlair = parseInt(numericMatch[0], 10);
        } else {
            scoreFromFlair = NaN;
        }
    }

    const flairScoreIsNaN = isNaN(scoreFromFlair);

    // Extract symbol by removing the numeric part from flair text, trim whitespace
    const flairSymbol = flairTextRaw.replace(/^\d+/, "").trim();

    if (settings[AppSetting.PrioritiseScoreFromFlair] && !flairScoreIsNaN) {
        return {
            currentScore: scoreFromFlair,
            flairScoreIsNaN,
            flairText: flairTextRaw,
            flairSymbol,
        };
    }

    return {
        currentScore:
            !flairScoreIsNaN && scoreFromFlair > scoreFromRedis
                ? scoreFromFlair
                : scoreFromRedis,
        flairScoreIsNaN,
        flairText: flairTextRaw,
        flairSymbol,
    };
}

export async function setUserScore(
    username: string,
    newScore: number,
    context: TriggerContext,
    settings: SettingsValues
): Promise<void> {
    const subredditName = await getSubredditName(context);

    // ✅ Store score in Redis under each timeframe
    const redisKey = `thanksPointsStore:${subredditName}:alltime`;
    await context.redis.zAdd(redisKey, {
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

    // ✅ Flair settings
    const flairSetting = ((settings[AppSetting.ExistingFlairHandling] as
        | string[]
        | undefined) ?? [
        ExistingFlairOverwriteHandling.OverwriteNumeric,
    ])[0] as ExistingFlairOverwriteHandling;

    const shouldSetUserFlair =
        flairSetting !== ExistingFlairOverwriteHandling.NeverSet;
    if (!shouldSetUserFlair) {
        return;
    }

    // ✅ Read flair styling preferences
    let cssClass = settings[AppSetting.CSSClass] as string | undefined;
    let flairTemplate = settings[AppSetting.FlairTemplate] as
        | string
        | undefined;

    if (!cssClass) cssClass = undefined;
    if (!flairTemplate) flairTemplate = undefined;
    if (cssClass && flairTemplate) cssClass = undefined; // template wins

    // ✅ Try to get user's score from their wiki page
    try {
        const userPage = await context.reddit.getWikiPage(
            subredditName,
            `user/${username}`
        );
        const wikiContent = userPage.content ?? "";
        const scoreMatch = wikiContent.match(/Total:\s*(\d+)/i);
        if (scoreMatch && !isNaN(parseInt(scoreMatch[1], 10))) {
            newScore = parseInt(scoreMatch[1], 10);
        }
    } catch {
        // ignore if missing
    }

    // ✅ Format flair text
    const pointSymbol = (settings[AppSetting.PointSymbol] as string) ?? "";
    let flairText = "";
    switch (flairSetting) {
        case ExistingFlairOverwriteHandling.OverwriteNumericSymbol:
            flairText = `${newScore}${pointSymbol}`;
            break;
        case ExistingFlairOverwriteHandling.OverwriteNumeric:
            flairText = `${newScore}`;
            break;
    }

    // ✅ Get the existing flair to compare
    let oldFlairText = "";
    try {
        const userObj = await context.reddit.getUserByUsername(username);
        const flairInfo = await userObj?.getUserFlairBySubreddit(subredditName);
        oldFlairText = flairInfo?.flairText ?? "";
    } catch {
        // ignore
    }

    const flairChanged = oldFlairText !== flairText;

    await context.reddit.setUserFlair({
        subredditName: subredditName,
        username: username,
        cssClass: cssClass,
        flairTemplateId: flairTemplate,
        text: flairText,
    });

    await context.redis.hSet(`userflair:${subredditName}`, {
        [username]: flairText,
    });

    logger.debug("✅ Setting user flair", {
        username,
        flairChanged,
        oldText: oldFlairText,
        newText: flairText,
        flairTemplateId: flairTemplate,
        cssClass,
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
        logger.warn("❌ Missing required event data.");
        return;
    }

    if (isLinkId(event.comment.parentId)) {
        logger.debug("❌ Parent ID is a link — ignoring.");
        return;
    }

    const settings = await context.settings.getAll();
    const parentComment = await context.reddit.getCommentById(
        event.comment.parentId
    );
    if (!parentComment) {
        logger.warn("❌ Parent comment not found.");
        return;
    }

    const pointName = (settings[AppSetting.PointName] as string) ?? "point";
    const pointSymbol = (settings[AppSetting.PointSymbol] as string) ?? "";

    // Parse user & mod commands
    const userCommandRaw = settings[AppSetting.PointTriggerWords] as
        | string
        | undefined;
    const userCommands = userCommandRaw
        ?.split(/\s+/)
        .map((cmd) => cmd.toLowerCase().trim())
        .filter(Boolean) ?? ["!point"];
    const modCommand = (
        settings[AppSetting.ModAwardCommand] as string | undefined
    )
        ?.toLowerCase()
        .trim();
    const allCommands = [...userCommands, ...(modCommand ? [modCommand] : [])];

    const commentBody = event.comment.body?.toLowerCase() ?? "";

    const isSystemAuthor = ["AutoModerator", context.appName].includes(
        event.author.name
    );
    if (
        isSystemAuthor &&
        allCommands.some((cmd) => commentBody.includes(cmd))
    ) {
        logger.debug("❌ System user attempted a command");
        return;
    }

    const botAwardMessage = formatMessage(
        (settings[AppSetting.BotAwardMessage] as string) ??
            TemplateDefaults.BotAwardMessage,
        {
            name: pointName,
        }
    );

    const recipient = parentComment.authorName;
    const awardeeIsBot = recipient === context.appName;

    if (awardeeIsBot) {
        logger.debug("❌ Bot cannot award itself points");
        await context.reddit.submitComment({
            id: event.comment.id,
            text: botAwardMessage,
        });
        return;
    }

    // Permission check
    const accessControl = ((settings[AppSetting.AccessControl] as string[]) ?? [
        "moderators-only",
    ])[0];
    const isMod = await isModerator(
        context,
        event.subreddit.name,
        event.author.name
    );

    const superUsers = ((settings[AppSetting.SuperUsers] as string) ?? "")
        .split("\n")
        .map((u) => u.trim().toLowerCase())
        .filter(Boolean);

    const authorName = event.author.name.toLowerCase();
    const isSuperUser = superUsers.includes(authorName);
    const isOP = event.author.id === event.post.authorId;

    const hasPermission =
        accessControl === "everyone" ||
        (accessControl === "moderators-only" && isMod) ||
        (accessControl === "moderators-and-superusers" &&
            (isMod || isSuperUser)) ||
        (accessControl === "moderators-superusers-and-op" &&
            (isMod || isSuperUser || isOP));

    const awarder = event.author.name;

    if (!hasPermission) {
        if (accessControl === "moderators-only") {
            const disallowedMessage = formatMessage(
                `You must be a moderator to award {{name}}s.`,
                {
                    name: pointName,
                }
            );

            await context.reddit.submitComment({
                id: event.comment.id,
                text: disallowedMessage,
            });
        } else if (accessControl === "moderators-and-superusers") {
            const disallowedMessage = formatMessage(
                `You must be a moderator or superuser to award {{name}}s.`,
                {
                    name: pointName,
                }
            );

            await context.reddit.submitComment({
                id: event.comment.id,
                text: disallowedMessage,
            });
        } else if (accessControl === "moderators-superusers-and-op") {
            const disallowedMessage = formatMessage(
                `You must be a moderator, superuser, or OP to award {{name}}s.`,
                {
                    name: pointName,
                }
            );

            await context.reddit.submitComment({
                id: event.comment.id,
                text: disallowedMessage,
            });
        }

        logger.warn("❌ Author does not have permission");
        return;
    }

    // Detect trigger
    const usesRegex = settings[AppSetting.ThanksCommandUsesRegex];
    const containsUserCommand = usesRegex
        ? userCommands
              .map((c) => new RegExp(c, "i"))
              .some((r) => r.test(commentBody))
        : userCommands.some((c) => commentBody.includes(c));

    const containsModCommand = modCommand && commentBody.includes(modCommand);

    if (!containsUserCommand && !containsModCommand) return;

    if (!recipient) {
        logger.warn("❌ No recipient found.");
        return;
    }

    if (awarder === recipient) {
        const selfMsg = formatMessage(
            (settings[AppSetting.SelfAwardMessage] as string) ??
                TemplateDefaults.NotifyOnSelfAwardTemplate,
            { awarder, name: pointName }
        );

        const notify = ((settings[
            AppSetting.NotifyOnSelfAward
        ] as string[]) ?? [NotifyOnSelfAwardReplyOptions.NoReply])[0];

        if (notify === NotifyOnSelfAwardReplyOptions.ReplyAsComment) {
            await context.reddit.submitComment({
                id: event.comment.id,
                text: selfMsg,
            });
        } else if (notify === NotifyOnSelfAwardReplyOptions.ReplyByPM) {
            await context.reddit.sendPrivateMessage({
                to: awarder,
                subject: `You tried to award yourself a ${pointName}`,
                text: selfMsg,
            });
        }

        logger.debug("❌ User tried to award themselves.");
        return;
    }

    // Check if already awarded
    const alreadyKey = `thanks-${parentComment.id}-${awarder}`;
    const modAlreadyAwardedKey = `modthanks-${parentComment.id}`;

    const [alreadyAwarded, modAlreadyAwarded] = await Promise.all([
        context.redis.exists(alreadyKey),
        context.redis.exists(modAlreadyAwardedKey),
    ]);

    if (alreadyAwarded) {
        const alreadyMsg = formatMessage(
            (settings[AppSetting.PointAlreadyAwardedMessage] as string) ??
                TemplateDefaults.NotifyOnPointAlreadyAwardedTemplate,
            { name: pointName }
        );

        const notify = ((settings[
            AppSetting.NotifyOnPointAlreadyAwarded
        ] as string[]) ?? ["none"])[0];

        if (notify === NotifyOnPointAlreadyAwardedReplyOptions.ReplyByPM) {
            await context.reddit.sendPrivateMessage({
                to: awarder,
                subject: `You've already awarded this comment`,
                text: alreadyMsg,
            });
        } else if (
            notify === NotifyOnPointAlreadyAwardedReplyOptions.ReplyAsComment
        ) {
            await context.reddit.submitComment({
                id: event.comment.id,
                text: alreadyMsg,
            });
        }

        // Check if it's a mod/superuser trying a second mod-award
        const isSuperuser = await getUserIsSuperuser(awarder, context);
        if ((isSuperuser || isMod) && containsModCommand && modAlreadyAwarded) {
            logger.warn("❌ Mod/Superuser attempted duplicate mod-award.");

            const modDuplicateMsg = formatMessage(
                `This comment has already received a moderator-approved {{name}}.`,
                { name: pointName }
            );

            if (notify === NotifyOnPointAlreadyAwardedReplyOptions.ReplyByPM) {
                await context.reddit.sendPrivateMessage({
                    to: awarder,
                    subject: `Already awarded with mod approval`,
                    text: modDuplicateMsg,
                });
            } else if (
                notify ===
                NotifyOnPointAlreadyAwardedReplyOptions.ReplyAsComment
            ) {
                await context.reddit.submitComment({
                    id: event.comment.id,
                    text: modDuplicateMsg,
                });
            }

            return;
        }

        logger.info("❌ Award was already given. Skipping.");
        return;
    }

    // Awarding the point
    const redisKey = `${POINTS_STORE_KEY}`;
    const newScore = await context.redis.zIncrBy(redisKey, recipient, 1);

    // Check for mod or user command awarding
    const isSuperuser = await getUserIsSuperuser(awarder, context);
    if ((isSuperuser || isMod) && containsModCommand) {
        // Set modAlreadyAwarded key
        await context.redis.set(modAlreadyAwardedKey, "1");

        const scoreboard = settings[AppSetting.ScoreboardName];
        const modAwardMsg = formatMessage(
            (settings[AppSetting.ApproveMessage] as string) ??
                TemplateDefaults.ApproveMessage,
            {
                scoreboard: `https://reddit.com/r/${context.subredditName}/wiki/${scoreboard}`,
                awardee: recipient,
                total: newScore.toString(),
                name: pointName,
                symbol: pointSymbol,
            }
        );

        const notifyOnModAward = ((settings[
            AppSetting.NotifyOnApprove
        ] as string[]) ?? ["none"])[0];

        if (notifyOnModAward === NotifyOnSuccessReplyOptions.ReplyByPM) {
            await context.reddit.sendPrivateMessage({
                to: awarder,
                subject: `You awarded 1 ${pointName}`,
                text: modAwardMsg,
            });
        } else if (
            notifyOnModAward === NotifyOnSuccessReplyOptions.ReplyAsComment
        ) {
            await context.reddit.submitComment({
                id: event.comment.id,
                text: modAwardMsg,
            });
        }
    } else if (!isSuperuser && !isMod && containsModCommand) {
        logger.info(
            "❌ User is trying to use modCommand, but isn't a Moderator or Superuser."
        );

        const modDenyMsg = formatMessage(
            `You do not have permission to use the "{{command}}" command.`,
            { command: modCommand }
        );

        await context.reddit.submitComment({
            id: event.comment.id,
            text: modDenyMsg,
        });

        return;
    } else if (containsUserCommand) {
        const notifySuccess = ((settings[
            AppSetting.NotifyOnSuccess
        ] as string[]) ?? ["none"])[0];

        const scoreboard = `https://reddit.com/r/${event.subreddit.name}/wiki/${
            settings[AppSetting.ScoreboardName] ?? "leaderboard"
        }`;

        const successMessage = formatMessage(
            (settings[AppSetting.SuccessMessage] as string) ??
                TemplateDefaults.NotifyOnSuccessTemplate,
            {
                awardee: recipient,
                awarder,
                total: newScore.toString(),
                name: pointName,
                symbol: pointSymbol,
                scoreboard,
            }
        );

        if (notifySuccess === NotifyOnSuccessReplyOptions.ReplyByPM) {
            await context.reddit.sendPrivateMessage({
                to: awarder,
                subject: `You awarded a ${pointName}`,
                text: successMessage,
            });
            await context.reddit.sendPrivateMessage({
                to: recipient,
                subject: `You were awarded a ${pointName}`,
                text: successMessage,
            });
        } else if (
            notifySuccess === NotifyOnSuccessReplyOptions.ReplyAsComment
        ) {
            await context.reddit.submitComment({
                id: event.comment.id,
                text: successMessage,
            });
        }
    }

    // 🧼 Final step: update flair
    await setUserScore(recipient, newScore, context, settings);
}

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function markdownEscape(input: string): string {
    return input.replace(/([\\`*_{}\[\]()#+\-.!])/g, "\\$1");
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
    await setUserScore(comment.authorName, newScore, context, settings);

    context.ui.showToast(`Score for ${comment.authorName} is now ${newScore}`);
}
