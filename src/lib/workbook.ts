// Turns a school's schedule sheet (see README → "The schedule sheet") into schedules and a calendar.
//
//   Settings       School name, time zone, first/last day, and the normal schedule for each weekday
//   Special Days   Only the exceptions: Date | End Date (optional) | Schedule | Note
//   <any other>    One tab per bell schedule; the tab name is the schedule name:  Period | Start | End
//
// Everything is matched loosely (case, spacing) and problems become warnings for /preview rather than
// errors, so one typo never blanks a hallway display.

import type { Tab } from './google';
import { weekdayOf } from './time';
import type { Block, DaySchedule, Kind, Schedule, Segment } from './types';

export interface SpecialDay {
	schedule: string;
	note: string;
}

export interface Workbook {
	name: string | null;
	timeZone: string | null;
	/** Settings → Clock: 24-hour. */
	clock24: boolean;
	firstDay: string | null;
	lastDay: string | null;
	/** Normal schedule name per weekday, 0 = Sunday … 6 = Saturday. */
	weekdays: Map<number, string>;
	/** Keyed by normalized schedule name. */
	schedules: Map<string, Schedule>;
	special: Map<string, SpecialDay>;
	warnings: string[];
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]/g, '');
const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const pad = (n: number) => String(n).padStart(2, '0');
/** "2026-09-08" → "9/8/2026", the way dates are typed in the sheet. */
const usDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${m}/${d}/${y}`; };

/** Values that mean "no students today" when they aren't the name of a schedule tab. */
export const isNoSchool = (s: string) =>
	/\b(no school|no classes|holiday|closed|vacation|recess|break|student[- ]free|staff development|professional development|teacher work|in-?service)\b/i.test(s);

/** A bad time zone would make every date calculation throw, so it's checked up front. */
const isTimeZone = (tz: string) => {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
};

const isSettingsTab =(name: string) => norm(name) === 'settings';
const isSpecialTab = (name: string) => ['specialdays', 'specialday', 'calendar', 'exceptions'].includes(norm(name));
const isIgnoredTab = (name: string) => name.startsWith('_') || /^(instructions|read ?me|how to|help|notes)\b/i.test(name.trim());

/**
 * "8:30", "8:30 AM", "1:40 PM", "13:40", "8:30:00 AM" → "HH:MM".
 * Without AM/PM, 1:00–6:59 are read as afternoon (a school day never starts before 7).
 */
export function parseTime(s: string): string | null {
	const m = clean(s).match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:([ap])\.?\s*m\.?)?$/i);
	if (!m) return null;
	let h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return null;
	if (m[3]) {
		if (h > 12 || h === 0) return null;
		h = (h % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0);
	} else if (h >= 1 && h < 7) h += 12;
	return `${pad(h)}:${pad(min)}`;
}

/** "9/7/2026", "2026-09-07", "Sep 7, 2026", "Monday, September 7, 2026" → "2026-09-07". */
export function parseDate(s: string): string | null {
	const t = clean(s);
	if (!t) return null;
	let y: number, m: number, d: number;
	let match: RegExpMatchArray | null;
	if ((match = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, m, d] = [+match[1], +match[2], +match[3]];
	else if ((match = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
		[m, d, y] = [+match[1], +match[2], +match[3]];
		if (y < 100) y += 2000;
	} else {
		const parsed = new Date(`${t.replace(/^[a-z]+,\s*/i, '')} 12:00 UTC`);
		if (Number.isNaN(parsed.getTime())) return null;
		[y, m, d] = [parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate()];
	}
	const check = new Date(Date.UTC(y, m - 1, d));
	if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
	return `${y}-${pad(m)}-${pad(d)}`;
}

const KIND_WORDS: Record<string, Kind> = {
	class: 'class', period: 'class', break: 'break', nutrition: 'break', lunch: 'lunch', passing: 'passing',
	advisory: 'advisory', homeroom: 'advisory', flex: 'advisory', event: 'event', assembly: 'event', staff: 'staff',
};

function kindOf(name: string, typed: string): Kind | undefined {
	const given = KIND_WORDS[norm(typed)];
	if (given) return given === 'class' ? undefined : given;
	if (/^period\b|^\d/i.test(name)) return undefined;
	if (/staff|teacher|faculty/i.test(name)) return 'staff';
	if (/lunch/i.test(name)) return 'lunch';
	if (/break|nutrition|recess/i.test(name)) return 'break';
	if (/passing/i.test(name)) return 'passing';
	if (/advis|homeroom|flex|\bta\b|tutorial|intervention/i.test(name)) return 'advisory';
	if (/assembly|rally|drill|testing|event/i.test(name)) return 'event';
	return undefined;
}

/** First row that has all of the given header words; returns its index and a column lookup. */
function findHeader(rows: string[][], ...required: RegExp[]) {
	for (let r = 0; r < rows.length; r++) {
		const cells = rows[r].map((c) => clean(c).toLowerCase());
		if (required.every((re) => cells.some((c) => re.test(c)))) {
			const col = (re: RegExp) => cells.findIndex((c) => re.test(c));
			return { row: r, col };
		}
	}
	return null;
}

function readSchedule(tab: Tab, warnings: string[]): Schedule | null {
	const where = `"${tab.name}" tab`;
	const header = findHeader(tab.rows, /^start/, /^end/);
	if (!header) {
		warnings.push(`The ${where} has no Start and End columns, so it isn't used as a bell schedule.`);
		return null;
	}
	const startCol = header.col(/^start/);
	const endCol = header.col(/^end/);
	let nameCol = header.col(/^(period|name|block|what)/);
	if (nameCol < 0) nameCol = [0, 1, 2].find((c) => c !== startCol && c !== endCol) ?? 0;
	const typeCol = header.col(/^(type|kind)/);
	const groupCol = header.col(/^(group|track)/);

	type Row = Segment & { group: string; line: number };
	const rows: Row[] = [];
	for (let r = header.row + 1; r < tab.rows.length; r++) {
		const cells = tab.rows[r];
		const rawName = clean(cells[nameCol]);
		const [startText, endText] = [clean(cells[startCol]), clean(cells[endCol])];
		if (!rawName && !startText && !endText) continue;
		const line = r + 1;
		const start = parseTime(startText);
		const end = parseTime(endText);
		if (!start || !end) {
			warnings.push(`${where}, row ${line}: couldn't read the time "${!start ? startText : endText}". Use a time like 8:30 or 1:45 PM.`);
			continue;
		}
		const name = /^\d+$/.test(rawName) ? `Period ${rawName}` : rawName || 'Period';
		if (end <= start) {
			warnings.push(`${where}, row ${line}: ${rawName ? name : 'this row'} ends (${endText}) before it starts (${startText}).`);
			continue;
		}
		const kind = kindOf(name, clean(cells[typeCol]));
		rows.push({ name, start, end, ...(kind && { kind }), group: groupCol >= 0 ? clean(cells[groupCol]) : '', line });
	}
	if (rows.length === 0) {
		warnings.push(`The ${where} has no periods with times yet.`);
		return null;
	}

	// Rows with a Group ("1st Lunch", "2nd Lunch"…) run side by side; consecutive grouped rows form one block.
	const blocks: Block[] = [];
	for (let i = 0; i < rows.length; ) {
		const { group, line, ...segment } = rows[i];
		if (!group) {
			blocks.push(segment);
			i++;
			continue;
		}
		let j = i;
		while (j < rows.length && rows[j].group) j++;
		const grouped = rows.slice(i, j);
		const groups = [...new Set(grouped.map((r) => r.group))];
		const segs = grouped.map(({ group: _g, line: _l, ...s }) => s);
		const names = [...new Set([...segs.filter((s) => !s.kind), ...segs.filter((s) => s.kind === 'event')].map((s) => s.name))];
		blocks.push({
			name: names.length ? names.join(' + ') : groups.join(' / '),
			start: segs.map((s) => s.start).sort()[0],
			end: segs.map((s) => s.end).sort().at(-1)!,
			kind: 'event',
			tracks: groups.map((g) => ({
				name: g,
				segments: grouped.filter((r) => r.group === g).map(({ group: _g, line: _l, ...s }) => s),
			})),
		});
		i = j;
	}

	blocks.sort((a, b) => a.start.localeCompare(b.start));
	const students = blocks.filter((b) => b.kind !== 'staff');
	for (let i = 1; i < students.length; i++) {
		if (students[i].start < students[i - 1].end) {
			warnings.push(`${where}: ${students[i].name} starts before ${students[i - 1].name} ends. Check the times.`);
		}
	}
	return { name: tab.name.trim(), blocks };
}

function readSettings(tab: Tab, wb: Workbook) {
	for (const row of tab.rows) {
		const key = norm(row[0] ?? '');
		const value = clean(row[1]);
		if (!key || !value) continue;
		if (key === 'schoolname' || key === 'school') wb.name = value;
		else if (key === 'timezone') {
			if (isTimeZone(value)) wb.timeZone = value;
			else wb.warnings.push(`Settings: "${value}" isn't a time zone name. Use one like America/New_York or Europe/London.`);
		} else if (key === 'clock' || key === 'timeformat') {
			if (/24/.test(value)) wb.clock24 = true;
			else if (!/12/.test(value)) wb.warnings.push(`Settings: Clock should be 12-hour or 24-hour, not "${value}".`);
		} else if (key === 'firstday' || key === 'firstdayofschool') {
			wb.firstDay = parseDate(value);
			if (!wb.firstDay) wb.warnings.push(`Settings: couldn't read the first day "${value}".`);
		} else if (key === 'lastday' || key === 'lastdayofschool') {
			wb.lastDay = parseDate(value);
			if (!wb.lastDay) wb.warnings.push(`Settings: couldn't read the last day "${value}".`);
		} else {
			const weekday = WEEKDAYS.indexOf(key);
			if (weekday >= 0) wb.weekdays.set(weekday, value);
		}
	}
}

function readSpecialDays(tab: Tab, wb: Workbook) {
	const header = findHeader(tab.rows, /^(date|start date|from)/, /^schedule/);
	if (!header) {
		wb.warnings.push(`The "${tab.name}" tab needs Date and Schedule columns.`);
		return;
	}
	const dateCol = header.col(/^(date|start date|from)/);
	const endCol = header.col(/^(end|through|to|until)/);
	const schedCol = header.col(/^schedule/);
	const noteCol = header.col(/^(note|description|event|reason|why)/);
	for (let r = header.row + 1; r < tab.rows.length; r++) {
		const cells = tab.rows[r];
		const [dateText, schedule] = [clean(cells[dateCol]), clean(cells[schedCol])];
		if (!dateText && !schedule) continue;
		const line = r + 1;
		const from = parseDate(dateText);
		if (!from) {
			wb.warnings.push(`"${tab.name}" row ${line}: couldn't read the date "${dateText}". Use a date like 9/7/2026.`);
			continue;
		}
		if (!schedule) {
			wb.warnings.push(`"${tab.name}" row ${line}: ${dateText} has no schedule.`);
			continue;
		}
		const endText = endCol >= 0 ? clean(cells[endCol]) : '';
		const to = endText ? parseDate(endText) : from;
		if (!to || to < from) {
			wb.warnings.push(`"${tab.name}" row ${line}: couldn't read the end date "${endText}".`);
			continue;
		}
		const note = noteCol >= 0 ? clean(cells[noteCol]) : '';
		for (let d = from; d <= to; d = nextDay(d)) {
			if (wb.special.has(d)) wb.warnings.push(`"${tab.name}" row ${line}: ${usDate(d)} is listed more than once; using the first.`);
			else wb.special.set(d, { schedule, note });
		}
	}
}

function nextDay(date: string): string {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function readWorkbook(tabs: Tab[]): Workbook {
	const wb: Workbook = {
		name: null, timeZone: null, clock24: false, firstDay: null, lastDay: null,
		weekdays: new Map(), schedules: new Map(), special: new Map(), warnings: [],
	};
	const settings = tabs.find((t) => isSettingsTab(t.name));
	const special = tabs.find((t) => isSpecialTab(t.name));
	if (settings) readSettings(settings, wb);
	else wb.warnings.push('There\'s no "Settings" tab, so no weekday has a normal schedule.');
	if (special) readSpecialDays(special, wb);

	for (const tab of tabs) {
		if (tab === settings || tab === special || isIgnoredTab(tab.name)) continue;
		const schedule = readSchedule(tab, wb.warnings);
		if (schedule) wb.schedules.set(norm(schedule.name), schedule);
	}

	// Every schedule name used must be a tab (or mean "no school").
	const known = (name: string) => wb.schedules.has(norm(name)) || isNoSchool(name);
	for (const [weekday, name] of wb.weekdays) {
		if (!known(name)) wb.warnings.push(`Settings: ${WEEKDAYS[weekday][0].toUpperCase() + WEEKDAYS[weekday].slice(1)} uses "${name}", but there's no tab with that name.`);
	}
	const unknown = new Map<string, string[]>();
	for (const [date, { schedule }] of wb.special) {
		if (!known(schedule)) unknown.set(schedule, [...(unknown.get(schedule) ?? []), date]);
	}
	for (const [name, dates] of unknown) {
		wb.warnings.push(`Special Days uses "${name}" on ${dates.slice(0, 3).map(usDate).join(', ')}${dates.length > 3 ? ` and ${dates.length - 3} more` : ''}, but there's no tab with that name.`);
	}
	return wb;
}

// Precedence: a Special Days row → outside the school year → the weekday's normal schedule (Settings).
export function resolveDay(wb: Workbook, date: string): DaySchedule {
	const special = wb.special.get(date);
	const weekday = weekdayOf(date);
	const outsideYear = (wb.firstDay && date < wb.firstDay) || (wb.lastDay && date > wb.lastDay);

	const label = special?.schedule ?? (outsideYear ? null : (wb.weekdays.get(weekday) ?? null));
	const base = { date, label, notes: special?.note || null, source: special ? ('special' as const) : label ? ('weekday' as const) : null };

	if (!label) {
		// No schedule for this day: a weekend or outside the school year is simply no school.
		const known = wb.weekdays.size > 0 || wb.firstDay;
		const status = outsideYear || [0, 6].includes(weekday) || known ? 'no-school' : 'not-found';
		return { ...base, status, scheduleName: null, blocks: [] };
	}
	const schedule = wb.schedules.get(norm(label));
	if (schedule) return { ...base, status: 'school', scheduleName: schedule.name, blocks: schedule.blocks };
	if (isNoSchool(label)) return { ...base, status: 'no-school', scheduleName: null, blocks: [] };
	return { ...base, status: 'unconfigured', scheduleName: null, blocks: [] };
}

const YEAR_END_WARNING_DAYS = 21;

/**
 * A reminder to set up next year, shown on /preview from three weeks before the Last day. Without it the
 * display quietly shows "No school" every day once the year is over.
 */
export function yearEndNotice(wb: Workbook, today: string): { ended: boolean; message: string } | null {
	if (!wb.lastDay) return null;
	const last = usDate(wb.lastDay);
	const todo = 'update the First day and Last day on the Settings tab and replace the Special Days';
	if (today > wb.lastDay) {
		return { ended: true, message: `The school year ended on ${last}, so every day now shows "No school". For next year, ${todo}.` };
	}
	const daysLeft = (Date.parse(wb.lastDay) - Date.parse(today)) / 86400000;
	if (daysLeft <= YEAR_END_WARNING_DAYS) {
		return { ended: false, message: `The school year ends on ${last}. Before the next one starts, ${todo}.` };
	}
	return null;
}
