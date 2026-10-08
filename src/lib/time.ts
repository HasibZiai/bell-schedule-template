// Timezone helpers shared by the server and the browser. All schedule math happens in the
// school's timezone, never the server's (UTC) or the viewer's device timezone.

const formatters = new Map<string, Intl.DateTimeFormat>();

export interface ZonedNow {
	/** YYYY-MM-DD */
	date: string;
	/** Seconds since local midnight. */
	seconds: number;
}

export function zonedNow(timeZone: string, at: Date = new Date()): ZonedNow {
	let fmt = formatters.get(timeZone);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-US', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23',
		});
		formatters.set(timeZone, fmt);
	}
	const p: Record<string, string> = {};
	for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
	return {
		date: `${p.year}-${p.month}-${p.day}`,
		seconds: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second),
	};
}

/** "13:05" → seconds since midnight. */
export function toSeconds(hhmm: string): number {
	const [h, m] = hhmm.split(':').map(Number);
	return h * 3600 + m * 60;
}

/** "13:05" → "1:05" (school-day times are unambiguous without AM/PM), or "13:05" on a 24-hour clock. */
export function formatTime(hhmm: string, clock24 = false): string {
	const [h, m] = hhmm.split(':').map(Number);
	const mm = String(m).padStart(2, '0');
	return clock24 ? `${String(h).padStart(2, '0')}:${mm}` : `${((h + 11) % 12) + 1}:${mm}`;
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(date: string): number {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, n: number): string {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function formatLongDate(date: string): string {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
		timeZone: 'UTC',
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric',
	});
}

export const isIsoDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
