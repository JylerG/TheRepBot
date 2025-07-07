import { Context, Form, FormOnSubmitEvent, JSONObject, MenuItemOnPressEvent, WikiPage, WikiPagePermissionLevel, ZMember } from "@devvit/public-api";
import pako from "pako";
import { POINTS_STORE_KEY } from "./thanksPoints.js";
import { getSubredditName } from "./utility.js";
import Ajv, { JSONSchemaType } from "ajv";
import { restoreFormKey } from "./main.js";
import { populateCleanupLogAndScheduleCleanup, scheduleAdhocCleanup } from "./cleanupTasks.js";
import pluralize from "pluralize";
import { AppSetting } from "./settings.js";
import { ADHOC_CLEANUP_JOB } from "./constants.js";
import { logger } from "./logger.js";

export interface CompactScore {
    u: string;
    s: number;
}

const schema: JSONSchemaType<CompactScore[]> = {
    type: "array",
    items: {
        type: "object",
        properties: {
            u: { type: "string" },
            s: { type: "integer" },
        },
        required: ["u", "s"],
        additionalProperties: false,
    },
};

export function compressScores(value: CompactScore[]): string {
    const compressed = Buffer.from(pako.deflate(JSON.stringify(value))).toString("base64");
    return compressed;
}

export function decompressScores(blob: string): CompactScore[] {
    const json = Buffer.from(pako.inflate(Buffer.from(blob, "base64"))).toString();
    return JSON.parse(json) as CompactScore[];
}

const BACKUP_WIKI_PAGE = "therepbot/backup";

export async function backupAllScores(_: MenuItemOnPressEvent, context: Context) {

    const backupEnabled = await context.settings.get<boolean>(AppSetting.EnableBackup);
    if (!backupEnabled) {
        context.ui.showToast("Backup function is disabled.");
        return;
    }

    const currentScores = await context.redis.zRange(POINTS_STORE_KEY, 0, -1);
    const currentScoreCount = await context.redis.zCard(POINTS_STORE_KEY);

    if (currentScores.length === 1000 && currentScoreCount > 1000) {
        context.ui.showToast("Cannot backup >1000 scores at this time.");
        return;
    }

    const compactScores = currentScores.map(score => ({ u: score.member, s: score.score }));
    const compressed = compressScores(compactScores);

    const subredditName = await getSubredditName(context);

    try {
        let wikiPage = await context.reddit.getWikiPage(subredditName, BACKUP_WIKI_PAGE);
        await context.reddit.updateWikiPage({ subredditName, page: BACKUP_WIKI_PAGE, content: compressed });
    } catch {
        await context.reddit.createWikiPage({ subredditName, page: BACKUP_WIKI_PAGE, content: compressed });
        await context.reddit.updateWikiPageSettings({
            subredditName,
            page: BACKUP_WIKI_PAGE,
            permLevel: WikiPagePermissionLevel.MODS_ONLY,
            listed: true,
        });
    }

    context.ui.showToast({
        text: "TheRepBot points have been backed up to the wiki",
        appearance: "success",
    });
}

export async function showRestoreForm(_: MenuItemOnPressEvent, context: Context) {

    const restoreEnabled = await context.settings.get<boolean>(AppSetting.EnableRestore);
    if (!restoreEnabled) {
        context.ui.showToast("Restore function is disabled in Settings.");
        return;
    }

    const subredditName = await getSubredditName(context);
    let wikiPage: WikiPage | undefined;

    try {
        wikiPage = await context.reddit.getWikiPage(subredditName, BACKUP_WIKI_PAGE);
    } catch {
    }

    if (!wikiPage) {
        context.ui.showToast("There are no backups to restore");
        return;
    }

    context.ui.showForm(restoreFormKey);
}

export async function restoreFormHandler(event: FormOnSubmitEvent<JSONObject>, context: Context) {

    const chosenAction = (event.values.action as string[])[0];

    const subredditName = await getSubredditName(context);
    let wikiPage: WikiPage | undefined;

    try {
        wikiPage = await context.reddit.getWikiPage(subredditName, BACKUP_WIKI_PAGE);
    } catch {
        context.ui.showToast("There are no backups to restore");
        return;
    }

    let scores: CompactScore[];
    try {
        scores = decompressScores(wikiPage.content);
    } catch (error) {
        logger.error(`Error trying to decode backup: ${error}`)
        context.ui.showToast("Sorry, the backup could not be decoded.");
        return;
    }

    const ajv = new Ajv.default();
    const validate = ajv.compile(schema);
    if (!validate(scores)) {
        context.ui.showToast("Sorry, the backup is in an invalid format.");
        return;
    }

    const existingScores = await context.redis.zRange(POINTS_STORE_KEY, 0, -1);

    const scoresToAdd = scores.filter(score => {
        const exists = existingScores.find(item => item.member === score.u);
        return score.s > 0 && (!exists || (chosenAction === "overwrite" && score.s > exists.score));
    });

    if (!scoresToAdd.length) {
        context.ui.showToast("No scores could be imported with the chosen settings.");
        return;
    }

    await context.redis.zAdd(POINTS_STORE_KEY, ...scoresToAdd.map(score => ({ member: score.u, score: score.s })));

    await populateCleanupLogAndScheduleCleanup(context);

    await context.scheduler.runJob({
        name: "updateLeaderboard",
        runAt: new Date(),
        data: { reason: "Imported data from backup" },
    });

    await context.redis.del("InstallDate");

    const existingJobs = await context.scheduler.listJobs();
    await Promise.all(existingJobs.filter(job => job.name === ADHOC_CLEANUP_JOB).map(job => context.scheduler.cancelJob(job.id)));
    await scheduleAdhocCleanup(context);

    context.ui.showToast(`Successfully imported ${scoresToAdd.length} ${pluralize("score", scoresToAdd.length)}.`);
}

export const restoreForm: Form = {
    title: "Restore TheRepBot Points",
    fields: [
        {
            name: "action",
            label: "Existing Score Handling",
            type: "select",
            options: [
                { label: "Overwrite a user's score if backup has a higher value", value: "overwrite" },
                { label: "Skip restore if user already has a score", value: "skip" },
            ],
            multiSelect: false,
            required: true,
            defaultValue: ["overwrite"],
        },
    ],
};
