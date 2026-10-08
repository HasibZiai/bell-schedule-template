import { DEFAULT_TZ } from 'astro:env/server';
import { schools, type SchoolConfig } from '../schools.config';
import { demoTabs } from '../demo';
import { fetchSheetTabs, sheetEditUrl, sheetIdOf } from './google';
import { readWorkbook, type Workbook } from './workbook';

// How long a school's sheet is reused before it's read from Google again. Each read downloads every tab, so this
// is longer than the displays' own checks (see POLL_MS in [school]/index.astro).
const REFRESH_MS = 2 * 60 * 1000;

export interface LoadedSchool {
	slug: string;
	name: string;
	timeZone: string;
	/** Link for editing the school's sheet, or null for the demo. */
	editUrl: string | null;
	workbook: Workbook;
	/** True when the sheet couldn't be refreshed and an older copy is being used. */
	stale: boolean;
	error: string | null;
}

export const findSchool = (slug: string | undefined): SchoolConfig | undefined =>
	schools.find((s) => s.slug.toLowerCase() === (slug ?? '').toLowerCase());

// Per-isolate cache. Workers keep isolates warm between requests, so most requests skip the fetch;
// the fetches themselves are also edge-cached by Cloudflare for the same period.
const cache = new Map<string, { at: number; workbook: Workbook }>();

export async function loadSchool(config: SchoolConfig): Promise<LoadedSchool> {
	const id = config.sheet === 'demo' ? null : sheetIdOf(config.sheet);
	const shape = (workbook: Workbook, stale: boolean, error: string | null): LoadedSchool => ({
		slug: config.slug,
		name: workbook.name || config.slug,
		timeZone: workbook.timeZone || DEFAULT_TZ,
		editUrl: id ? sheetEditUrl(id) : null,
		workbook,
		stale,
		error,
	});

	const hit = cache.get(config.slug);
	if (hit && Date.now() - hit.at < REFRESH_MS) return shape(hit.workbook, false, null);
	try {
		if (config.sheet !== 'demo' && !id) throw new Error(`"${config.sheet}" isn't a Google Sheets link.`);
		const tabs = id ? await fetchSheetTabs(id, REFRESH_MS / 1000) : demoTabs();
		const workbook = readWorkbook(tabs);
		cache.set(config.slug, { at: Date.now(), workbook });
		return shape(workbook, false, null);
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		console.error(`Loading ${config.slug} failed:`, error);
		// Serve the last good copy rather than going blank on a hallway display.
		if (hit) return shape(hit.workbook, true, error);
		return shape(readWorkbook([]), true, error);
	}
}
