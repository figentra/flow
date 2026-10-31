import { t as src_default } from "./src.mjs";
import { t as ensureChangesetFolder } from "./shared.mjs";
import { ExitError, PreEnterButInPreModeError, PreExitButNotInPreModeError } from "@changesets/errors";
import { log } from "@clack/prompts";
import { getPackages } from "@manypkg/get-packages";
import { enterPre, exitPre } from "@changesets/pre";
//#region src/commands/pre/index.ts
async function pre(options) {
	const cwd = options.cwd ?? process.cwd();
	const packages = await getPackages(cwd);
	await ensureChangesetFolder(packages.rootDir);
	if (options.command === "enter") try {
		await enterPre(packages.rootDir, options.tag);
		log.success(`Entered pre mode with tag ${src_default.green(options.tag)}!\nRun ${src_default.cyan("changeset version")} to version packages with prerelease versions.`);
	} catch (err) {
		if (err instanceof PreEnterButInPreModeError) {
			log.error(`${src_default.cyan("changeset pre enter")} cannot be run when in pre mode.\nIf you're trying to exit pre mode, run ${src_default.cyan("changeset pre exit")}.`);
			throw new ExitError(1);
		}
		throw err;
	}
	else try {
		await exitPre(packages.rootDir);
		log.success(`Exited pre mode!\nRun ${src_default.cyan("changeset version")} to version packages with normal versions.\n\nPlease also review the changesets in the ${src_default.blue(".changeset/pre")} folder as they will be used as changelogs for the normal versions. Only include the changesets that will be relevant for the normal versions.`);
	} catch (err) {
		if (err instanceof PreExitButNotInPreModeError) {
			log.error(`${src_default.cyan("changeset pre exit")} can only be run when in pre mode!\nIf you're trying to enter pre mode, run ${src_default.cyan("changeset pre enter")}.`);
			throw new ExitError(1);
		}
		throw err;
	}
}
//#endregion
export { pre };
