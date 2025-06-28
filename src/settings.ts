import {
    JSONObject,
    ScheduledJobEvent,
    SettingsFormField,
    SettingsFormFieldValidatorEvent,
    TriggerContext,
} from "@devvit/public-api";
import { VALIDATE_REGEX_JOB } from "./constants.js";
import pluralize from "pluralize";

export enum ExistingFlairOverwriteHandling {
    OverwriteNumeric = "overwritenumeric",
    OverwriteAll = "overwriteall",
    NeverSet = "neverset",
}

export enum LeaderboardMode {
    Off = "off",
    ModOnly = "modonly",
    Public = "public",
}

export enum AppSetting {
    ThanksCommandUsesRegex = "thanksCommandUsesRegex",
    ModAwardCommand = "approveCommand",
    AnyoneCanAwardPoints = "anyoneCanAwardPoints",
    SuperUsers = "superUsers",
    AutoSuperuserThreshold = "autoSuperuserThreshold",
    NotifyOnAutoSuperuser = "notifyOnAutoSuperuser",
    NotifyOnAutoSuperuserTemplate = "notifyOnAutoSuperuserTemplate",
    UsersWhoCannotBeAwardedPoints = "excludedUsers",
    UsersWhoCannotAwardPoints = "usersWhoCantAwardPoints",
    ExistingFlairHandling = "existingFlairHandling",
    ExistingFlairCosmeticHandling = "existingFlairCosmeticHandling",
    CSSClass = "thanksCSSClass",
    FlairTemplate = "thanksFlairTemplate",
    NotifyOnError = "notifyOnError",
    NotifyOnErrorTemplate = "notifyOnErrorTemplate",
    NotifyOnSuccess = "notifyOnSuccess",
    NotifyOnSuccessTemplate = "notifyOnSuccessTemplate",
    NotifyAwardedUser = "notifyAwardedUser",
    NotifyAwardedUserTemplate = "notifyAwardedUserTemplate",
    SetPostFlairOnThanks = "setPostFlairOnThanks",
    SetPostFlairText = "setPostFlairOnThanksText",
    SetPostFlairCSSClass = "setPostFlairOnThanksCSSClass",
    SetPostFlairTemplate = "setPostFlairOnThanksTemplate",
    LeaderboardMode = "leaderboardMode",
    ScoreboardLink = "scoreboardLink",
    LeaderboardWikiPage = "leaderboardWikiPage",
    LeaderboardSize = "leaderboardSize",
    LeaderboardHelpPage = "leaderboardHelpPage",
    PostFlairTextToIgnore = "postFlairTextToIgnore",
    EnableBackup = "enableBackup",
    EnableRestore = "enableRestore",
    PrioritiseScoreFromFlair = "prioritiseScoreFromFlair",
    PointTriggerWords = "pointTriggerWords",
    SuccessMessage = "successMessage",
    SelfAwardMessage = "selfAwardMessage",
    DuplicateAwardMessage = "duplicateAwardMessage",
    BotAwardMessage = "botAwardMessage",
    PointName = "pointName",
    DisallowedFlairs = "disallowedFlairs",
    DisallowedFlairMessage = "disallowedFlairMessage",
    ApproveMessage = "approveMessage",
    DenyCommand = "denyCommand",
    DenyMessage = "denyMessage",
    PointSymbol = "pointSymbol",
    AccessControl = "accessControl",
    ModOnlyDisallowedMessage = "modOnlyDisallowedMessage",
    ApprovedOnlyDisallowedMessage = "approvedOnlyDisallowedMessage",
    AllowUnflairedPosts = "allowUnflairedPosts",
    UnflairedPostMessage = "unflairedPostMessage",
}

export const appSettings: SettingsFormField[] = [
    // === POINT SYSTEM ===
    {
        type: "group",
        label: "Point System Settings",
        fields: [
            {
                type: "select",
                name: AppSetting.AccessControl,
                label: "Who Can Award?",
                helpText: "Choose who is allowed to award points.",
                options: [
                    { label: "Moderators Only", value: "moderators-only" },
                    {
                        label: "Mods and Approved Users",
                        value: "moderators-and-approved-users",
                    },
                    { label: "Everyone", value: "everyone" },
                ],
                defaultValue: ["moderators-only"],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                type: "string",
                name: AppSetting.DisallowedFlairs,
                label: "Disallowed Flairs",
                helpText:
                    "Comma-separated flair texts where points cannot be awarded.",
                defaultValue: "",
            },
            {
                type: "paragraph",
                name: AppSetting.PointTriggerWords,
                label: "Trigger Words",
                helpText:
                    "List of trigger words users can type to award points (e.g., !award, .point). Each command should be on a new line. If you want to use regex, enable the option below.",
                defaultValue: "!award",
                onValidate: ({ value }) => {
                    if (!value) {
                        return "You must specify at least one command";
                    }
                },
            },
            {
                name: AppSetting.ModAwardCommand,
                type: "string",
                label: "Alternate command for mods and trusted users to award reputation points",
                helpText: "Optional.",
                defaultValue: "!modaward",
            },
            {
                type: "string",
                name: AppSetting.DenyCommand,
                label: "Moderator Deny Command",
                helpText: "Command to revoke a previously awarded point.",
                defaultValue: "!remove",
            },
            {
                type: "string",
                name: AppSetting.PointName,
                label: "Point Name",
                helpText:
                    "The name shown in award messages, like 'point', 'kudo', etc.",
                defaultValue: "point",
            },
            {
                type: "string",
                name: AppSetting.PointSymbol,
                label: "Point Symbol",
                helpText:
                    "Optional emoji or character to show alongside point totals. Leave empty for no symbol.",
                defaultValue: "⭐",
            },
            {
                name: AppSetting.ThanksCommandUsesRegex,
                type: "boolean",
                label: "Treat user commands as regular expressions",
                defaultValue: false,
                onValidate: validateRegexes,
            },
        ],
    },
    {
        type: "group",
        label: "Flair Setting Options",
        fields: [
            {
                name: AppSetting.ExistingFlairHandling,
                type: "select",
                label: "Flair setting option",
                options: [
                    {
                        label: "Set flair to new score, if flair unset or flair is numeric",
                        value: ExistingFlairOverwriteHandling.OverwriteNumeric,
                    },
                    {
                        label: "Set flair to new score, if user has no flair",
                        value: ExistingFlairOverwriteHandling.OverwriteAll,
                    },
                    {
                        label: "Never set flair",
                        value: ExistingFlairOverwriteHandling.NeverSet,
                    },
                ],
                multiSelect: false,
                defaultValue: [ExistingFlairOverwriteHandling.OverwriteNumeric],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                name: AppSetting.CSSClass,
                type: "string",
                label: "CSS class to use for points flairs",
                helpText:
                    "Optional. Please choose either a CSS class or flair template, not both.",
            },
            {
                name: AppSetting.FlairTemplate,
                type: "string",
                label: "Flair template ID to use for points flairs",
                helpText:
                    "Optional. Please choose either a CSS class or flair template, not both.",
                onValidate: isFlairTemplateValid,
            },
        ],
    },
    {
        type: "group",
        label: "Post Flair Setting Options",
        fields: [
            {
                name: AppSetting.SetPostFlairOnThanks,
                type: "boolean",
                label: "Set post flair when a reputation point is awarded",
                helpText:
                    "This can be used to mark a question as resolved, or answered",
                defaultValue: false,
            },
            {
                name: AppSetting.SetPostFlairText,
                type: "string",
                label: "Post Flair Text",
            },
            {
                name: AppSetting.SetPostFlairCSSClass,
                type: "string",
                label: "Post Flair CSS Class",
                helpText:
                    "Optional. Please choose either a CSS class or flair template, not both.",
            },
            {
                name: AppSetting.SetPostFlairTemplate,
                type: "string",
                label: "Post Flair Template ID",
                helpText:
                    "Optional. Please choose either a CSS class or flair template, not both.",
                onValidate: isFlairTemplateValid,
            },
        ],
    },
    {
        type: "group",
        label: "Messages",
        fields: [
            {
                type: "string",
                name: AppSetting.SuccessMessage,
                label: "Success Message",
                helpText:
                    "Message when a point is awarded. You can use {awardee} to get the person being awarded's username, {awarder} to get the person awarding's username, {symbol} to get the symbol (if one is specified), {total} to get the awardee's total score, {name} to get the name of the point, {scoreboard} to link to the scoreboard wiki page.",
                defaultValue:
                    "+1 {name} awarded to u/{awardee} by u/{awarder}. Total: {total}{symbol}. Scoreboard is located [here]({scoreboard})",
            },
            {
                type: "string",
                name: AppSetting.SelfAwardMessage,
                label: "Self Award Message",
                helpText:
                    "Shown when someone tries to award themselves. You can use {name}.",
                defaultValue: "You can't award yourself a {name}.",
            },
            {
                type: "string",
                name: AppSetting.DuplicateAwardMessage,
                label: "Duplicate Award Message",
                helpText:
                    "Shown when someone tries to award a post they've already awarded. You can use {awardee}, {total}, {name}.",
                defaultValue:
                    "This user has already been awarded for this comment.",
            },
            {
                type: "string",
                name: AppSetting.BotAwardMessage,
                label: "Bot Award Message",
                helpText:
                    "Shown when someone tries to award the bot. You can use {name}.",
                defaultValue: "You can't award the bot a {name}.",
            },
            {
                type: "string",
                name: AppSetting.ApproveMessage,
                label: "Moderator Award Message",
                helpText:
                    "Shown when a mod awards a point. Use {awardee}, {total}, {symbol}, {name}.",
                defaultValue:
                    "Award approved! u/{awardee} now has {total}{symbol} {name}s.",
            },
            {
                type: "string",
                name: AppSetting.DenyMessage,
                label: "Moderator Deny Message",
                helpText:
                    "Message when a mod removes a point. You can use {name}.",
                defaultValue: "{name} removed by a moderator.",
            },
            {
                type: "string",
                name: AppSetting.ModOnlyDisallowedMessage,
                label: "Non-Mod Access Denied Message",
                helpText:
                    "Message for users when only mods can award. You can use {name}.",
                defaultValue: "Only moderators are allowed to award {name}s.",
            },
            {
                type: "string",
                name: AppSetting.ApprovedOnlyDisallowedMessage,
                label: "Non-Approved Access Denied Message",
                helpText:
                    "Message when a non-approved user tries to award. You can use {name}.",
                defaultValue:
                    "Only moderators and approved users can award {name}s.",
            },
            {
                type: "string",
                name: AppSetting.DisallowedFlairMessage,
                label: "Disallowed Flair Message",
                helpText:
                    "Message shown when awarding on disallowed flair. You can use {name}.",
                defaultValue:
                    "Points cannot be awarded on posts with this flair. Please choose another post.",
            },
            {
                type: "string",
                name: AppSetting.UnflairedPostMessage,
                label: "Unflaired Post Message",
                helpText: "Shown when trying to award on an unflaired post.",
                defaultValue:
                    "Points cannot be awarded on posts without flair. Please award only on flaired posts.",
            },
        ],
    },
    {
        type: "group",
        label: "Misc Settings",
        fields: [
            {
                name: AppSetting.LeaderboardMode,
                type: "select",
                options: [
                    { label: "Off", value: LeaderboardMode.Off },
                    { label: "Mod Only", value: LeaderboardMode.ModOnly },
                    {
                        label: "Default settings for wiki",
                        value: LeaderboardMode.Public,
                    },
                ],
                label: "Wiki Leaderboard Mode",
                multiSelect: false,
                defaultValue: [LeaderboardMode.Off],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                name: AppSetting.LeaderboardSize,
                type: "number",
                label: "Leaderboard Size",
                helpText: "Number of users to show on the leaderboard (1-30).",
                defaultValue: 10,
                onValidate: ({ value }) => {
                    if (value && (value < 1 || value > 30)) {
                        return "Value should be between 1 and 30";
                    }
                },
            },
            {
                name: AppSetting.ScoreboardLink,
                type: "string",
                defaultValue:
                    "https://reddit.com/r/{subreddit}/wiki/leaderboard",
                label: "Scoreboard Wiki Link",
                helpText:
                    "Full URL to the scoreboard wiki page. Use '{subreddit}' placeholder to dynamically insert subreddit name.",
            },
            {
                name: AppSetting.LeaderboardWikiPage,
                type: "string",
                label: "Leaderboard Wiki Page",
                defaultValue: "therepbotleaderboard",
                onValidate: ({ value }) => {
                    const wikiPageNameRegex = /^[\w/]+$/i;
                    if (value && !wikiPageNameRegex.test(value)) {
                        return "Invalid wiki page name. Wiki page name must consist of alphanumeric characters and / characters only.";
                    }
                },
            },
            {
                name: AppSetting.LeaderboardHelpPage,
                type: "string",
                label: "Leaderboard Help Page",
                helpText:
                    "Optional. A web page (e.g. on your wiki, or an announcement post) telling users how to use reputation points on your subreddit. Please use a full URL, e.g. https://www.reddit.com/r/yourSubreddit/wiki/yourLeaderboard.",
            },
            {
                type: "select",
                name: AppSetting.AllowUnflairedPosts,
                label: "Allow on Unflaired Posts?",
                helpText: "Allow awarding on posts without flair?",
                options: [
                    { label: "Yes", value: "yes" },
                    { label: "No", value: "no" },
                ],
                defaultValue: ["no"],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                type: "string",
                name: "creditSystemWiki",
                label: "Credit System Wiki",
                helpText:
                    "Wiki page name that explains how the point system works.",
                defaultValue: "credit-system",
            },
        ],
    },
    {
        type: "group",
        label: "Backup and Restore",
        fields: [
            {
                name: AppSetting.EnableBackup,
                type: "boolean",
                label: "Enable Backup",
                defaultValue: true,
            },
            {
                name: AppSetting.EnableRestore,
                type: "boolean",
                label: "Enable Restore",
                helpText:
                    "This should be left disabled to prevent inadvertent score overwriting. Only enable during restore operations.",
                defaultValue: false,
            },
        ],
    },
];

export enum ReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

const replyOptionChoices = [
    { label: "No Notification", value: ReplyOptions.NoReply },
    { label: "Send user a private message", value: ReplyOptions.ReplyByPM },
    { label: "Reply as comment", value: ReplyOptions.ReplyAsComment },
];

export enum TemplateDefaults {
    NotifyOnErrorTemplate = "Hello {{awarder}},\n\nYou cannot award a point to yourself.\n\nPlease contact the mods if you have any questions.\n\n---\n\n^(I am a bot)",
    NotifyOnSuccessTemplate = "You have awarded 1 point to {{awardee}}.\n\n---\n\n^(I am a bot - please contact the mods with any questions)",
    NotifyAwardedUserTemplate = "Hello {{awardee}},\n\nYou have been awarded a point for your contribution! New score: {{score}}\n\n---\n\n^(I am a bot - please contact the mods with any questions)",
    NotifyOnSuperuserTemplate = "Hello {{awardee}},\n\nNow that you have reached {{threshold}} points you can now award points yourself, even if you're not the OP. Please use the command \"{{command}}\" if you'd like to do this.\n\n---\n\n^(I am a bot - please contact the mods with any questions)",
}

function isFlairTemplateValid(event: SettingsFormFieldValidatorEvent<string>) {
    const flairTemplateRegex = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){4}[0-9a-f]{8}$/;
    if (event.value && !flairTemplateRegex.test(event.value)) {
        return "Invalid flair template ID";
    }
}

function selectFieldHasOptionChosen(
    event: SettingsFormFieldValidatorEvent<string[]>
) {
    if (!event.value || event.value.length !== 1) {
        return "You must choose an option";
    }
}

async function validateRegexes(
    event: SettingsFormFieldValidatorEvent<boolean>,
    context: TriggerContext
) {
    if (!event.value) {
        return;
    }

    const user = await context.reddit.getCurrentUser();
    if (!user) {
        return;
    }

    await context.scheduler.runJob({
        name: VALIDATE_REGEX_JOB,
        runAt: new Date(),
        data: { username: user.username },
    });
}

export async function validateRegexJobHandler(
    event: ScheduledJobEvent<JSONObject | undefined>,
    context: TriggerContext
) {
    const username = event.data?.username as string | undefined;
    if (!username) {
        return;
    }

    const settings = await context.settings.getAll();
    if (!settings[AppSetting.ThanksCommandUsesRegex]) {
        return;
    }

    console.log("Running settings validator");

    const userCommandVal = settings[AppSetting.PointTriggerWords] as
        | string
        | undefined;
    const userCommandList =
        userCommandVal
            ?.split("\n")
            .map((command) => command.toLowerCase().trim()) ?? [];
    const invalidCommands: string[] = [];

    for (const command of userCommandList) {
        try {
            new RegExp(command);
        } catch {
            invalidCommands.push(command);
        }
    }

    if (invalidCommands.length === 0) {
        return;
    }

    let message = `The app settings are configured to treat user commands as regular expressions, but ${
        invalidCommands.length
    } ${pluralize(
        "command",
        invalidCommands.length
    )} is not a valid regular expression:\n\n`;

    message += invalidCommands.map((command) => `* ${command}`).join("\n");

    const subredditName =
        context.subredditName ??
        (await context.reddit.getCurrentSubreddit()).name;

    await context.reddit.sendPrivateMessage({
        subject: `TheRepBot settings on /r/${subredditName} are invalid`,
        text: message,
        to: username,
    });
}
