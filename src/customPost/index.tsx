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
import { getSubredditName } from "../utility.js";
import { logger } from "../logger.js";

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
            defaultValue: 10,
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
}

export async function createCustomPostFormHandler(
    event: FormOnSubmitEvent<JSONObject>,
    context: Context
) {
    const redisKey = "customPostData";
    logger.info("CustomPost: Form submitted", { values: event.values });

    try {
        if (event.values.removeExisting) {
            const customPostData = await context.redis.get(redisKey);
            logger.debug("CustomPost: Existing post data", { redisKey, customPostData });

            if (customPostData) {
                const data = JSON.parse(customPostData) as CustomPostData;
                const post = await context.reddit.getPostById(data.postId);
                await post.remove();
                logger.info("CustomPost: Removed previous leaderboard post", { postId: data.postId });
            }
        }

        let postTitle = event.values.postTitle as string | undefined;
        postTitle ??= "TheRepBot High Scores";

        const subredditName = await getSubredditName(context);
        logger.debug("CustomPost: Submitting new post", { subredditName, postTitle });

        const post = await context.reddit.submitPost({
            subredditName,
            title: postTitle,
            preview: previewPost,
        });

        const newData: CustomPostData = {
            postId: post.id,
            numberOfUsers:
                (event.values.numberOfUsers as number | undefined) ?? 20,
        };

        await context.redis.set(redisKey, JSON.stringify(newData));
        logger.info("CustomPost: Stored new leaderboard post data", { newData });

        if (event.values.stickyPost) {
            await post.sticky();
            logger.info("CustomPost: Post stickied", { postId: post.id });
        }

        context.ui.showToast({
            text: "Leaderboard post has been created successfully",
            appearance: "success",
        });

        context.ui.navigateTo(post);
        logger.info("CustomPost: Navigated to new leaderboard post", { postId: post.id });
    } catch (err) {
        logger.error("CustomPost: Failed to create leaderboard post", { error: err });
        context.ui.showToast({
            text: "Failed to create leaderboard post. See logs.",
            appearance: "neutral",
        });
    }
}

export function createCustomPostMenuHandler (_: MenuItemOnPressEvent, context: Context) {
    logger.info("CustomPost: Showing leaderboard creation form.");
    context.ui.showForm(customPostFormKey);
}

export const leaderboardCustomPost: CustomPostType = {
    name: "leaderboardCustomPost",
    description: "Post that displays TheRepBot high scorers",
    height: "tall",
    render: (context) => {
        logger.debug("CustomPost: Rendering leaderboard custom post.");
        const state = new LeaderboardState(context);

        return (
            <blocks height="tall">
                <vstack minHeight="100%" minWidth="100%" width="100%" alignment="top center" gap="small" grow>
                    <hstack alignment="center middle" minWidth="100%" border="thick" padding="small" gap="large">
                        <image imageHeight={48} imageWidth={48} url="podium.png" />
                        <vstack alignment="center middle" grow>
                            <text style="heading">Top scoring users</text>
                        </vstack>
                        {state.leaderboardHelpUrl[0] ? (
                            <button
                                icon="help"
                                onPress={() => {
                                    logger.info("CustomPost: Navigating to help URL", {
                                        url: state.leaderboardHelpUrl[0],
                                    });
                                    state.context.ui.navigateTo(state.leaderboardHelpUrl[0]);
                                }}
                            />
                        ) : (
                            <image imageHeight={48} imageWidth={48} url="podium.png" />
                        )}
                    </hstack>
                    <vstack alignment="middle center" padding="medium" gap="medium" width="100%" grow>
                        <vstack alignment="top start" gap="small" width="100%" grow>
                            {state.leaderboard
                                .slice(
                                    (state.page - 1) * state.leaderboardPageSize,
                                    state.page * state.leaderboardPageSize
                                )
                                .map((entry) => (
                                    <LeaderboardRow
                                        username={entry.username}
                                        score={entry.score}
                                        rank={entry.rank}
                                        navigateToProfile={() => {
                                            logger.info("CustomPost: Navigating to user profile", {
                                                username: entry.username,
                                            });
                                            context.ui.navigateTo(`https://reddit.com/u/${entry.username}`);
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
                                        logger.info("CustomPost: Moved to previous leaderboard page", {
                                            newPage: state.page,
                                        });
                                    }}
                                >
                                    {" "}
                                    &lt;
                                </button>
                                <spacer />
                                <text
                                    onPress={() => {
                                        state.page = 1;
                                        logger.info("CustomPost: Reset leaderboard to page 1.");
                                    }}
                                >
                                    {state.page}
                                </text>
                                <spacer />
                                <button
                                    disabled={state.page === state.maxPage}
                                    onPress={() => {
                                        state.page += 1;
                                        logger.info("CustomPost: Moved to next leaderboard page", {
                                            newPage: state.page,
                                        });
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
