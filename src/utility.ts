import { TriggerContext } from "@devvit/public-api";
import { addWeeks } from "date-fns";

export function replaceAll (input: string, pattern: string, replacement: string): string {
    return input.split(pattern).join(replacement);
}

export async function isModerator (context: TriggerContext, subredditName: string, username: string): Promise<boolean> {
    const filteredModeratorList = await context.reddit.getModerators({ subredditName, username }).all();
    return filteredModeratorList.length > 0;
}

export async function getSubredditName (context: TriggerContext): Promise<string> {
    if (context.subredditName) {
        return context.subredditName;
    }

    const subredditName = await context.redis.get("subredditname");
    if (subredditName) {
        return subredditName;
    }

    const subreddit = await context.reddit.getCurrentSubreddit();
    await context.redis.set("subredditname", subreddit.name, { expiration: addWeeks(new Date(), 1) });
    return subreddit.name;
}

export async function replacePlaceholders(template: string, placeholders: {
    awardee: string;
    awarder: string;
    point: string;
    total: number;
    symbol: string;
    scoreboard: string;
    permalink: string;
    command: string;
}): Promise<string> {
    let result = template;
    result = replaceAll(result, "{{awardee}}", placeholders.awardee);
    result = replaceAll(result, "{{awarder}}", placeholders.awarder);
    result = replaceAll(result, "{{name}}", placeholders.point);
    result = replaceAll(result, "{{total}}", placeholders.total.toString());
    result = replaceAll(result, "{{symbol}}", placeholders.symbol);
    result = replaceAll(result, "{{scoreboard}}", placeholders.scoreboard);
    result = replaceAll(result, "{{permalink}}", placeholders.permalink);
    result = replaceAll(result, "{{command}}", placeholders.command);
    return result;
}
