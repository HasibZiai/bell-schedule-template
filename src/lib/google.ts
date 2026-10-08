// Reads a Google Sheet shared as "Anyone with the link can view", without an API key:
//   - the sheet's HTML view lists its tabs (name + gid)
//   - each tab downloads as CSV

export interface Tab {
	name: string;
	rows: string[][];
}

export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') {
			row.push(field);
			field = '';
		} else if (ch === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else if (ch !== '\r') field += ch;
	}
	row.push(field);
	rows.push(row);
	return rows;
}

/** The spreadsheet ID from any Google Sheets link (or a bare ID). */
export function sheetIdOf(link: string): string | null {
	const m = link.match(/\/spreadsheets\/d\/([\w-]{20,})/) ?? link.match(/^([\w-]{20,})$/);
	return m?.[1] ?? null;
}

export const sheetEditUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;

/** The HTML view embeds its tab list as JS: items.push({name: "Settings", pageUrl: "…", gid: "0"… */
export function parseTabList(html: string): { name: string; gid: string }[] {
	const unescapeJs = (s: string) =>
		s
			.replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
			.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
			.replace(/\\(.)/g, '$1');
	return [...html.matchAll(/items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)"[^}]*?gid:\s*"(\d+)"/g)].map((m) => ({
		name: unescapeJs(m[1]).trim(),
		gid: m[2],
	}));
}

async function fetchOk(url: string, cacheSeconds: number, expect: string): Promise<string> {
	const res = await fetch(url, {
		cf: { cacheTtl: cacheSeconds, cacheEverything: true },
		// Google redirects to a sign-in page when the sheet isn't shared publicly; don't follow it.
		redirect: 'manual',
	} as RequestInit);
	if ((res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403) {
		throw new Error('The sheet isn\'t shared as "Anyone with the link can view".');
	}
	const type = res.headers.get('content-type') ?? '';
	if (!res.ok || !type.includes(expect)) throw new Error(`Google returned ${res.status} ${type || '(no content type)'}.`);
	return res.text();
}

export async function fetchSheetTabs(id: string, cacheSeconds: number): Promise<Tab[]> {
	const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}`;
	const list = parseTabList(await fetchOk(`${base}/htmlview`, cacheSeconds, 'text/html'));
	if (list.length === 0) throw new Error("Couldn't find any tabs in the sheet.");
	return Promise.all(
		list.map(async ({ name, gid }) => ({
			name,
			rows: parseCsv(await fetchOk(`${base}/export?format=csv&gid=${gid}`, cacheSeconds, 'text/csv')),
		})),
	);
}
