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
import { LeaderboardEntry, LeaderboardState } from "./state.js";
import { customPostFormKey } from "../main.js";
import { previewPost } from "./preview.js";
import { getSubredditName } from "../utility.js";

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
    ],
};

export interface CustomPostData {
    postId: string;
    numberOfUsers: number;
    entries?: LeaderboardEntry[];
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

    const subredditName = await getSubredditName(context);

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

function pluralize(word: string): string {
    if (word.endsWith("s")) return word;

    const lowerWord = word.toLowerCase();
    if (lowerWord.match(/[^aeiou]y$/)) {
        return word.slice(0, -1) + "ies";
    }
    if (lowerWord.match(/(s|x|z|ch|sh)$/)) {
        return word + "es";
    }
    return word + "s";
}

export const leaderboardCustomPost: CustomPostType = {
    name: "leaderboardCustomPost",
    description: "Post that displays TheRepBot high scorers",
    height: "tall",
    render: (context) => {
        const state = new LeaderboardState(context);
        
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
                            
                            <button
                                onPress={async () => {
                                    await state.updateLeaderboard();
                                }}
                            >
                                🔄 Refresh Leaderboard
                            </button>
                            {state.leaderboard
                                .slice(
                                    (state.page - 1) *
                                        state.leaderboardPageSize,
                                    state.page * state.leaderboardPageSize
                                )
                                .map((entry) => (
                                    <LeaderboardRow
                                        username={entry.username}
                                        score={entry.score}
                                        rank={entry.rank}
                                        pointName={pluralize(
                                            entry.pointName ?? "point"
                                        )}
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
                                    disabled={state.page === 1}
                                    onPress={() => {
                                        state.page -= 1;
                                    }}
                                >
                                    {" "}
                                    &lt;
                                </button>
                                <spacer />
                                <text
                                    onPress={() => {
                                        state.page = 1;
                                    }}
                                >
                                    {state.page}
                                </text>
                                <spacer />
                                <button
                                    disabled={state.page === state.maxPage}
                                    onPress={() => {
                                        state.page += 1;
                                    }}
                                >
                                    {" "}
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
