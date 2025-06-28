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
    NotifyUsersWhenAPointIsAwarded = "notifyUsersWhenAPointIsAwarded",
    UsersWhoCannotAwardPointsMessage = "usersWhoCannotAwardPointsMessage",
    UsersWhoCannotBeAwardedPointsMessage = "usersWhoCannotBeAwardedPointsMessage",
    ThanksCommandUsesRegex = "thanksCommandUsesRegex",
    ModAwardCommand = "approveCommand",
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
    InvalidPostMessage = "invalidPostMessage",
    ApproveMessage = "approveMessage",
    DenyCommand = "denyCommand",
    DenyMessage = "denyMessage",
    PointSymbol = "pointSymbol",
    AccessControl = "accessControl",
    ModOnlyDisallowedMessage = "modOnlyDisallowedMessage",
    ApprovedOnlyDisallowedMessage = "approvedOnlyDisallowedMessage",
    AllowUnflairedPosts = "allowUnflairedPosts",
    UnflairedPostMessage = "unflairedPostMessage",
    LeaderboardHelpPageMessage = "leaderboardHelpPageMessage",
}

export enum TemplateDefaults {
    DisallowedFlairMessage = "Points cannot be awarded on posts with this flair. Please choose another post.",
    UsersWhoCannotAwardPointsMessage = "You do not have permission to award points.",
    ModOnlyDisallowedMessage = "Only moderators are allowed to award points.",
    ApprovedOnlyDisallowedMessage = "Only moderators and approved users can award points.",
    DuplicateAwardMessage = "This user has already been awarded for this comment.",
    SelfAwardMessage = "You can't award yourself a {name}.",
    BotAwardMessage = "You can't award the bot a {name}.",
    UsersWhoCannotBeAwardedPointsMessage = "The user you are trying to award points to is not allowed to be awarded points. Please contact the moderators if you have any questions.",
    InvalidPostMessage = "Points cannot be awarded on this post because the recipient is suspended or shadowbanned.",
    NotifyOnErrorTemplate = "Hello {{awarder}},\n\nYou cannot award a point to yourself.\n\nPlease contact the mods if you have any questions.\n\n---\n\n^(I am a bot)",
    NotifyOnSuccessTemplate = "+1 {point} to u/{{awardee}}.\n\n---\n\n^(I am a bot - please contact the mods with any questions)",
    NotifyAwardedUserTemplate = "Hello {{awardee}},\n\nYou have been awarded a point for your contribution! New score: {{score}}\n\n---\n\n^(I am a bot - please contact the mods with any questions)",
    NotifyOnSuperuserTemplate = "Hello {{awardee}},\n\nNow that you have reached {{threshold}} points you can now award points yourself, even if you're not the OP. Please use the command \"{{command}}\" if you'd like to do this.\n\n---\n\n^(I am a bot - please contact the mods with any questions)",
}

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
                type: "paragraph",
                name: AppSetting.UsersWhoCannotAwardPoints,
                label: "Users Who Cannot Award Points",
                helpText:
                    "List of usernames who cannot award points, even if they are mods or approved users. Each username should be on a new line.",
                defaultValue: "",
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
                    if (!value || value.trim() === "") {
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
            {
                type: "select",
                name: AppSetting.NotifyOnError,
                label: "Notify users when an error occurs",
                options: [
                    { label: "Do not notify", value: ReplyOptions.NoReply },
                    {
                        label: "Reply with comment",
                        value: ReplyOptions.ReplyAsComment,
                    },
                    {
                        label: "Send a private message",
                        value: ReplyOptions.ReplyByPM,
                    },
                ],
                defaultValue: [ReplyOptions.NoReply],
            },
            {
                type: "select",
                name: AppSetting.NotifyOnSuccess,
                label: "Notify users when an action is successful",
                options: [
                    { label: "Do not notify", value: ReplyOptions.NoReply },
                    {
                        label: "Reply with comment",
                        value: ReplyOptions.ReplyAsComment,
                    },
                    {
                        label: "Send a private message",
                        value: ReplyOptions.ReplyByPM,
                    },
                ],
                defaultValue: [ReplyOptions.NoReply],
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
                helpText:
                    "Optional. Please enter the text to display for the post flair.",
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
                name: AppSetting.UsersWhoCannotAwardPointsMessage,
                label: "User Cannot Award Points Message",
                helpText: `Message shown when a user tries to award points but is not allowed to. Specified in the "Users Who Cannot Award Points" setting.`,
                defaultValue: "You do not have permission to award {{point}}s.",
            },
            {
                name: AppSetting.NotifyOnAutoSuperuserTemplate,
                type: "paragraph",
                label: "Template of message sent when a user reaches the trusted user threshold",
                helpText:
                    "Placeholder supported: {{authorname}}, {{permalink}}, {{threshold}}, {{command}}",
                defaultValue: TemplateDefaults.NotifyOnSuperuserTemplate,
            },
            {
                type: "string",
                name: AppSetting.SuccessMessage,
                label: "Success Message",
                helpText:
                    "Message when a point is awarded. You can use {{awardee}} to get the person being awarded's username, {{awarder}} to get the person awarding's username, {{symbol}} to get the symbol (if one is specified), {{total}} to get the awardee's total score, {{name}} to get the name of the point, {{scoreboard}} to link to the scoreboard wiki page.",
                defaultValue:
                    "+1 {{name}} awarded to u/{{awardee}} by u/{{awarder}}. Total: {{total}}{{symbol}}. Scoreboard is located [here]({{scoreboard}})",
            },
            {
                type: "string",
                name: AppSetting.SelfAwardMessage,
                label: "Self Award Message",
                helpText:
                    "Shown when someone tries to award themselves. You can use {{name}}.",
                defaultValue: "You can't award yourself a {{name}}.",
            },
            {
                type: "string",
                name: AppSetting.DuplicateAwardMessage,
                label: "Duplicate Award Message",
                helpText:
                    "Shown when someone tries to award a post they've already awarded. You can use {{awardee}}, {{total}}, {{name}}.",
                defaultValue:
                    "This user has already been awarded for this comment.",
            },
            {
                type: "string",
                name: AppSetting.BotAwardMessage,
                label: "Bot Award Message",
                helpText:
                    "Shown when someone tries to award the bot. You can use {{name}}.",
                defaultValue: "You can't award the bot a {{name}}.",
            },
            {
                type: "string",
                name: AppSetting.ApproveMessage,
                label: "Moderator Award Message",
                helpText:
                    "Shown when a mod awards a point. Use {{awardee}}, {{total}}, {{symbol}}, {{name}}.",
                defaultValue:
                    "Award approved! u/{{awardee}} now has {{total}}{{symbol}} {{name}}s.",
            },
            {
                type: "string",
                name: AppSetting.DenyMessage,
                label: "Moderator Deny Message",
                helpText:
                    "Message when a mod removes a point. You can use {{name}}.",
                defaultValue: "{{name}} removed by a moderator.",
            },
            {
                type: "string",
                name: AppSetting.ModOnlyDisallowedMessage,
                label: "Non-Mod Access Denied Message",
                helpText:
                    "Message for users when only mods can award. You can use {{name}}.",
                defaultValue: "Only moderators are allowed to award {{name}}s.",
            },
            {
                type: "string",
                name: AppSetting.ApprovedOnlyDisallowedMessage,
                label: "Non-Approved Access Denied Message",
                helpText:
                    "Message when a non-approved user tries to award. You can use {{name}}.",
                defaultValue:
                    "Only moderators and approved users can award {{name}}s.",
            },
            {
                type: "string",
                name: AppSetting.DisallowedFlairMessage,
                label: "Disallowed Flair Message",
                helpText:
                    "Message shown when awarding on disallowed flair. You can use {{name}}.",
                defaultValue:
                    "Points cannot be awarded on posts with this flair. Please choose another post.",
            },
            {
                type: "string",
                name: AppSetting.InvalidPostMessage,
                label: "Invalid Post Message",
                helpText:
                    "Message shown when awarding is attempted on disallowed or invalid posts. You can use {{name}}.",
                defaultValue:
                    "Points cannot be awarded on this post because the recipient is suspended or shadowbanned.",
            },
            {
                type: "string",
                name: AppSetting.UnflairedPostMessage,
                label: "Unflaired Post Message",
                helpText: "Shown when trying to award on an unflaired post.",
                defaultValue:
                    "Points cannot be awarded on posts without flair. Please award only on flaired posts.",
            },
            {
                name: AppSetting.UsersWhoCannotBeAwardedPointsMessage,
                label: "Users Who Cannot Be Awarded Points Message",
                helpText:
                    "Message shown when trying to award points to a user who is excluded from receiving points. Supports {{awardee}} placeholder.",
                type: "string",
                defaultValue:
                    "Sorry, you cannot award points to {{awardee}} as they are excluded from receiving points.",
            },
        ],
    },
    {
        type: "group",
        label: "Misc Settings",
        fields: [
            {
                name: AppSetting.NotifyUsersWhenAPointIsAwarded,
                type: "select",
                label: "Notify users when a point is awarded",
                options: replyOptionChoices,
                multiSelect: false,
                defaultValue: [ReplyOptions.NoReply],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                name: AppSetting.NotifyOnAutoSuperuser,
                type: "select",
                label: "Notify users who reach the auto trusted user threshold",
                options: replyOptionChoices,
                multiSelect: false,
                defaultValue: [ReplyOptions.NoReply],
                onValidate: selectFieldHasOptionChosen,
            },
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
                    if (value !== undefined && (value < 1 || value > 30)) {
                        return "Value should be between 1 and 30";
                    }
                },
            },
            {
                name: AppSetting.ScoreboardLink,
                type: "string",
                defaultValue:
                    "https://reddit.com/r/{{subreddit}}/wiki/leaderboard",
                label: "Scoreboard Wiki Link",
                helpText:
                    "Full URL to the scoreboard wiki page. Use '{{subreddit}}' placeholder to dynamically insert subreddit name.",
            },
            {
                name: AppSetting.LeaderboardWikiPage,
                type: "string",
                label: "Leaderboard Wiki Page",
                defaultValue: "leaderboard",
            },
            {
                name: AppSetting.LeaderboardHelpPage,
                type: "string",
                label: "Leaderboard Help Page",
                helpText:
                    "Optional. A web page (e.g. on your wiki, or an announcement post) telling users how to use reputation points on your subreddit. Please use a full URL, e.g. https://www.reddit.com/r/yourSubreddit/wiki/yourLeaderboard.",
            },
            {
                name: AppSetting.LeaderboardHelpPageMessage,
                type: "string",
                label: "Leaderboard Help Page Message",
                helpText:
                    "Optional. A message to show at the top of the leaderboard wiki page, like `[Learn how it works]({{help}})`. `{{help}}` will be replaced with the actual link from the 'Leaderboard Help Page' setting.",
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

function isFlairTemplateValid(event: SettingsFormFieldValidatorEvent<string>) {
    const flairTemplateRegex = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){4}[0-9a-f]{8}$/i;
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
    event: ScheduledJobEvent<JSONObject>,
    context: TriggerContext
) {
    const { username } = event.data as { username: string };
    const user = await context.reddit.getUserByUsername(username);
    if (!user) return;

    // Here you would perform regex validation on user commands.
    // This is an example: you can extend with actual validation logic.
    // For demo, just log.
    console.log(`Validating regex commands for user ${username}`);
}
