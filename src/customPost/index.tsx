import {
    Context,
    CustomPostType,
    Devvit,
    Form,
    FormOnSubmitEvent,
    JSONObject,
    MenuItemOnPressEvent,
} from "@devvit/public-api";
import { LeaderboardRow } from "./leaderboardRow.js";
import { LeaderboardState } from "./state.js";
import { customPostFormKey } from "../main.js";
import { previewPost } from "./preview.js";
import { AppSetting } from "../settings.js";
import pluralize from "pluralize";

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

export const customPostForm: Form = {
    title: "Create Leaderboard Post",
    fields: [
        {
            label: "Post title",
            name: "postTitle",
            type: "string",
            defaultValue: "TheRepBot High Scores",
        },
        {
            label: "Number of users to include",
            name: "numberOfUsers",
            type: "number",
            defaultValue: 20,
        },
        {
            label: "Sticky post",
            name: "stickyPost",
            type: "boolean",
            defaultValue: true,
        },
        {
            label: "Remove previous leaderboard post",
            name: "removeExisting",
            type: "boolean",
            defaultValue: true,
        },
        {
            label: "Lock comment by bot?",
            helpText: "The bot will post a comment explaining the post and how to refresh it if the post is empty. This option decides whether or not users can reply to that comment.",
            name: "lockBotComment",
            type: "boolean",
            defaultValue: true,
        },
    ],
};

export interface CustomPostData {
    postId: string;
    numberOfUsers: number;
}

export async function createCustomPostFormHandler(
    event: FormOnSubmitEvent<JSONObject>,
    context: Context
) {
    const redisKey = "customPostData";

    if (event.values.removeExisting) {
        const customPostData = await context.redis.get(redisKey);
        if (customPostData) {
            const data = JSON.parse(customPostData) as CustomPostData;
            const post = await context.reddit.getPostById(data.postId);
            await post.remove();
        }
    }

    let postTitle = event.values.postTitle as string | undefined;
    postTitle ??= "TheRepBot High Scores";

    const subredditName =
        context.subredditName ??
        (await context.reddit.getCurrentSubredditName());

    const post = await context.reddit.submitPost({
        subredditName,
        title: postTitle,
        preview: previewPost,
    });

    const newData: CustomPostData = {
        postId: post.id,
        numberOfUsers: (event.values.numberOfUsers as number | undefined) ?? 20,
    };

    await context.redis.set(redisKey, JSON.stringify(newData));

    if (event.values.stickyPost) {
        await post.sticky();
    }

    const settings = await context.settings.getAll();
    const pointName = pluralize(settings[AppSetting.PointName] as string ?? "point");
    // --- NEW: Bot posts a message to the newly created leaderboard post ---
    const botMessage = formatMessage(
        `This post displays the top **${newData.numberOfUsers}** users with the most ${pointName} in this subreddit.\n\n`
        + `It is updated periodically, but you can also refresh it manually by clicking the refresh button at the top of the leaderboard.`,
        {}
    );
    const comment = await context.reddit.submitComment({
        id: post.id,
        text: botMessage,
    });

    // Sticky the bot comment
    await comment.distinguish(true);

    if (event.values.lockBotComment) {
        await comment.lock();
    }

    context.ui.showToast({
        text: "Leaderboard post has been created successfully",
        appearance: "success",
    });
    context.ui.navigateTo(post);
}

export function createCustomPostMenuHandler(
    _: MenuItemOnPressEvent,
    context: Context
) {
    context.ui.showForm(customPostFormKey);
}

export const leaderboardCustomPost: CustomPostType = {
    name: "leaderboardCustomPost",
    description: "Post that displays TheRepBot high scorers",
    height: "tall",
    render: (context) => {
        const state = new LeaderboardState(context);

        const leaderboard = state.leaderboardEntries[0] || [];
        const page = state.leaderboardPage[0] || 1;

        const startIndex = (page - 1) * state.leaderboardPageSize;
        const endIndex = page * state.leaderboardPageSize;
        const pageEntries = leaderboard.slice(startIndex, endIndex);

        return (
            <blocks height="tall">
                <vstack
                    minHeight="100%"
                    minWidth="100%"
                    width="100%"
                    alignment="top center"
                    gap="small"
                    grow
                >
                    <hstack
                        alignment="center middle"
                        minWidth="100%"
                        border="thick"
                        padding="small"
                        gap="large"
                    >
                        <image
                            imageHeight={48}
                            imageWidth={48}
                            url="podium.png"
                        />
                        <vstack alignment="center middle" grow>
                            <text style="heading">Top scoring users</text>
                        </vstack>
                        {state.leaderboardHelpUrl[0] ? (
                            <button
                                icon="help"
                                onPress={() => {
                                    state.context.ui.navigateTo(
                                        state.leaderboardHelpUrl[0]
                                    );
                                }}
                            ></button>
                        ) : (
                            <image
                                imageHeight={48}
                                imageWidth={48}
                                url="podium.png"
                            />
                        )}
                    </hstack>
                    <vstack alignment="top" gap="medium" padding="small">
                        <button
                            icon="refresh"
                            onPress={async () => {
                                try {
                                    // Assuming `state` is your LeaderboardState instance
                                    await state.updateLeaderboard();
                                    console.log("✅ Leaderboard updated!");
                                } catch (err) {
                                    console.error(
                                        "❌ Failed to update leaderboard",
                                        err
                                    );
                                }
                            }}
                        />
                    </vstack>
                    <vstack
                        alignment="middle center"
                        padding="medium"
                        gap="medium"
                        width="100%"
                        grow
                    >
                        <vstack
                            alignment="top start"
                            gap="small"
                            width="100%"
                            grow
                        >
                            {pageEntries.map((entry) => (
                                <LeaderboardRow
                                    pointName={capitalize(pluralize(
                                        entry.pointName || "point"
                                    ))}
                                    username={entry.username}
                                    score={entry.score}
                                    rank={entry.rank}
                                    navigateToProfile={() => {
                                        context.ui.navigateTo(
                                            `https://reddit.com/u/${entry.username}`
                                        );
                                    }}
                                />
                            ))}
                        </vstack>

                        <vstack alignment="bottom start" grow>
                            <hstack alignment="middle center" gap="small">
                                <button
                                    disabled={page === 1}
                                    onPress={() =>
                                        state.leaderboardPage[1](page - 1)
                                    }
                                >
                                    &lt;
                                </button>
                                <spacer />
                                <text
                                    onPress={() => {
                                        state.leaderboardPage; // Set page to 1
                                    }}
                                >
                                    {page}
                                </text>
                                <spacer />
                                <button
                                    disabled={page === state.maxPage}
                                    onPress={() =>
                                        state.leaderboardPage[1](page + 1)
                                    }
                                >
                                    &gt;
                                </button>
                            </hstack>
                        </vstack>
                    </vstack>
                </vstack>
            </blocks>
        );
    },
};

export async function getScoresFromWiki(
    context: Context
): Promise<Record<string, number>> {
    const subredditName = await context.reddit.getCurrentSubredditName();
    const settings = await context.settings.getAll();
    const pageName =
        (settings[AppSetting.ScoreboardName] as string) ?? "leaderboard";

    const wiki = await context.reddit.getWikiPage(subredditName, pageName);
    const content = wiki.content ?? "";

    const scores: Record<string, number> = {};

    const lines = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    // Find the start of the markdown table
    const startIndex = lines.findIndex((l) => l.startsWith("-|"));
    for (let i = startIndex + 1; i < lines.length; i++) {
        const parts = lines[i].split("|").map((p) => p.trim());
        if (parts.length >= 2) {
            const username = parts[0].replace(/^u\//, "");
            const score = parseInt(parts[1], 10);
            if (!isNaN(score)) {
                scores[username] = score;
            }
        }
    }
    return scores;
}
