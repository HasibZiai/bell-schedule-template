/** Visual/behavioral category of a block. `staff` rows render smaller and never count as the students' "current period". */
export type Kind = 'class' | 'break' | 'lunch' | 'passing' | 'advisory' | 'event' | 'staff';

/** A span of time. Times are 24-hour "HH:MM" in the school's timezone. */
export interface Segment {
	name: string;
	start: string;
	end: string;
	kind?: Kind;
}

/** One of several parallel schedules inside a block, e.g. "1st Rally" vs "2nd Rally" buildings. */
export interface Track {
	name: string;
	detail?: string;
	segments: Segment[];
}

/** A row in the day's schedule. With `tracks`, the block can be shown split (side by side) or unified. */
export interface Block extends Segment {
	tracks?: Track[];
}

/** One bell schedule: a tab in the school's sheet. */
export interface Schedule {
	name: string;
	blocks: Block[];
}

export type DayStatus = 'school' | 'no-school' | 'unconfigured' | 'not-found';

export interface DaySchedule {
	date: string;
	/** The schedule name the sheet assigns to this day ("Minimum Day", "No School"…). */
	label: string | null;
	notes: string | null;
	status: DayStatus;
	scheduleName: string | null;
	/** Where the day's schedule came from: a Special Days row, or the Settings tab's weekday default. */
	source: 'special' | 'weekday' | null;
	blocks: Block[];
}

export interface TodayResponse {
	school: string;
	timeZone: string;
	/** Show times as 13:40 instead of 1:40 PM (the sheet's Settings tab: Clock = 24-hour). */
	clock24: boolean;
	/** Server time when the response was made; the display uses it to correct a device clock that's off. */
	generatedAt: string;
	/** True when the school's sheet couldn't be refreshed and an older copy was used. */
	stale: boolean;
	day: DaySchedule;
}
