import { describe, expect, it } from 'vitest';
import { parseCsv, type Tab } from '../src/lib/google';
import { formatTime } from '../src/lib/time';
import { parseDate, parseTime, readWorkbook, resolveDay, yearEndNotice } from '../src/lib/workbook';

// A school on a rotating block schedule: an all-periods "anchor" Monday, odd/even block days with Flex or
// Advisory, minimum days, and a rally where two groups take turns. Each CSV is one tab of the sheet.
const files = import.meta.glob<string>('./fixtures/block-schedule/*.csv', { query: '?raw', import: 'default', eager: true });
const fixtureTabs = (): Tab[] =>
	Object.entries(files).map(([path, csv]) => ({ name: path.split('/').pop()!.slice(0, -4), rows: parseCsv(csv.trim()) }));

const wb = readWorkbook(fixtureTabs());
const day = (date: string) => resolveDay(wb, date);
const names = (date: string) => day(date).blocks.map((b) => b.name);

describe('the block schedule sheet', () => {
	it('reads without warnings', () => {
		expect(wb.warnings).toEqual([]);
	});

	it('reads the Settings tab', () => {
		expect(wb.name).toBe('Block Schedule Test School');
		expect(wb.timeZone).toBe('America/Los_Angeles');
		expect(wb.clock24).toBe(true);
		expect(wb.firstDay).toBe('2026-08-12');
		expect(wb.lastDay).toBe('2027-06-03');
	});

	it('makes every other tab a bell schedule, except ones starting with _', () => {
		expect([...wb.schedules.values()].map((s) => s.name).sort()).toEqual([
			'Anchor Day',
			'Even Day + Advisory',
			'Even Day + Flex',
			'Even Day + Rally',
			'Even Minimum Day',
			'Odd Day + Advisory',
			'Odd Day + Flex',
			'Odd Minimum Day',
		]);
	});
});

describe('ordinary weekdays use the Settings tab', () => {
	it('Monday: anchor day with every period after a staff meeting', () => {
		const monday = day('2026-10-12');
		expect(monday).toMatchObject({ status: 'school', scheduleName: 'Anchor Day', source: 'weekday' });
		expect(monday.blocks[0]).toMatchObject({ name: 'Staff Meeting', start: '08:00', kind: 'staff' });
		expect(names('2026-10-12').filter((n) => n.startsWith('Period'))).toEqual(
			[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Period ${n}`),
		);
		expect(monday.blocks.find((b) => b.name === 'Extended Passing')?.kind).toBe('passing');
	});

	it('Tuesday through Friday: odd and even block days', () => {
		expect(day('2026-10-13').scheduleName).toBe('Odd Day + Flex');
		expect(day('2026-10-14').scheduleName).toBe('Even Day + Flex');
		expect(day('2026-10-15').scheduleName).toBe('Odd Day + Advisory');
		expect(day('2026-10-16').scheduleName).toBe('Even Day + Advisory');
		expect(names('2026-10-13')).toEqual(['Period 1', 'Break', 'Period 3', 'Lunch', 'Period 5', 'Flex', 'Period 7']);
		expect(names('2026-10-16')).toEqual(['Period 2', 'Break', 'Period 4', 'Lunch', 'Period 6', 'Advisory', 'Period 8']);
	});

	it('guesses each row type from its name', () => {
		const kinds = Object.fromEntries(day('2026-10-13').blocks.map((b) => [b.name, b.kind]));
		expect(kinds).toEqual({
			'Period 1': undefined,
			Break: 'break',
			'Period 3': undefined,
			Lunch: 'lunch',
			'Period 5': undefined,
			Flex: 'advisory',
			'Period 7': undefined,
		});
	});

	it('reads 12-hour, bare and 24-hour times the same way', () => {
		const times = (date: string) => day(date).blocks.map((b) => [b.start, b.end]);
		// Odd Day + Flex uses "1:40 PM", Even Day + Flex uses "1:40", the Advisory days use "13:40".
		expect(times('2026-10-14')).toEqual(times('2026-10-13'));
		expect(times('2026-10-15')).toEqual(times('2026-10-13'));
		expect(day('2026-10-14').blocks.at(-1)).toMatchObject({ start: '14:15', end: '15:40' });
	});

	it('has no school on weekends or outside the school year', () => {
		for (const date of ['2026-10-17', '2026-10-18', '2026-08-11', '2027-06-04']) {
			expect(day(date)).toMatchObject({ status: 'no-school', blocks: [] });
		}
		// The first day is a Wednesday.
		expect(day('2026-08-12').scheduleName).toBe('Even Day + Flex');
	});
});

describe('Special Days override the weekday', () => {
	it('a rally day splits period 4 into two groups', () => {
		const rally = day('2026-10-23');
		expect(rally).toMatchObject({ scheduleName: 'Even Day + Rally', source: 'special', notes: 'Homecoming Rally' });
		const block = rally.blocks.find((b) => b.tracks)!;
		expect(block).toMatchObject({ name: 'Period 4 + Rally', start: '10:05', end: '12:15', kind: 'event' });
		expect(block.tracks!.map((t) => t.name)).toEqual(['1st Rally', '2nd Rally']);
		expect(block.tracks![0].segments.map((s) => s.name)).toEqual([
			'Check-in',
			'Walk / Seating',
			'Rally',
			'Walk & Check-in',
			'Period 4',
		]);
		expect(block.tracks![1].segments[0]).toMatchObject({ name: 'Period 4', start: '10:05', end: '11:20' });
		expect(names('2026-10-23')).toEqual(['Period 2', 'Break', 'Period 4 + Rally', 'Lunch', 'Period 6', 'Period 8']);
	});

	it('minimum days', () => {
		expect(day('2026-12-18')).toMatchObject({ scheduleName: 'Even Minimum Day', notes: 'Last day before Winter Break' });
		expect(day('2026-12-18').blocks.at(-1)?.end).toBe('12:55');
		expect(day('2027-06-03').scheduleName).toBe('Odd Minimum Day');
	});

	it('no-school days, single and ranged', () => {
		expect(day('2026-09-07')).toMatchObject({ status: 'no-school', label: 'No School', notes: 'Labor Day' });
		for (const date of ['2026-11-23', '2026-11-25', '2026-11-27']) expect(day(date).status).toBe('no-school');
		expect(day('2026-11-30').scheduleName).toBe('Anchor Day');
	});

	it('names like "Winter Break" and "Student Free Day" mean no school without a tab', () => {
		for (const date of ['2026-12-21', '2026-12-25', '2027-01-01']) {
			expect(day(date)).toMatchObject({ status: 'no-school', label: 'Winter Break' });
		}
		expect(day('2027-01-04')).toMatchObject({ status: 'no-school', label: 'Student Free Day' });
	});
});

describe('parseTime', () => {
	it.each([
		['8:30 AM', '08:30'],
		['8:30am', '08:30'],
		['8:30 a.m.', '08:30'],
		['12:05 PM', '12:05'],
		['12:05 AM', '00:05'],
		['1:40 PM', '13:40'],
		['13:40', '13:40'],
		['8:30:00 AM', '08:30'],
		['1:40', '13:40'],
		['6:59', '18:59'],
		['7:00', '07:00'],
	])('%s → %s', (input, expected) => expect(parseTime(input)).toBe(expected));

	it.each(['', 'noon', '8', '25:00', '8:60', '13:00 PM', '0:30 AM'])('rejects %j', (input) =>
		expect(parseTime(input)).toBeNull(),
	);
});

describe('parseDate', () => {
	it.each([
		['9/7/2026', '2026-09-07'],
		['09/07/26', '2026-09-07'],
		['2026-09-07', '2026-09-07'],
		['2026-9-7', '2026-09-07'],
		['Sep 7, 2026', '2026-09-07'],
		['Monday, September 7, 2026', '2026-09-07'],
	])('%s → %s', (input, expected) => expect(parseDate(input)).toBe(expected));

	it.each(['', 'soon', '2/30/2027', '13/1/2026'])('rejects %j', (input) => expect(parseDate(input)).toBeNull());
});

describe('formatTime', () => {
	it.each([
		['08:05', false, '8:05'],
		['12:30', false, '12:30'],
		['13:40', false, '1:40'],
		['08:05', true, '08:05'],
		['13:40', true, '13:40'],
	])('%s (24-hour: %s) → %s', (input, clock24, expected) => expect(formatTime(input, clock24)).toBe(expected));
});

describe('the Clock setting', () => {
	const clock = (value: string) => readWorkbook([{ name: 'Settings', rows: [['Clock', value]] }]);

	it.each([['24-hour', true], ['24 hour', true], ['24', true], ['12-hour', false], ['12', false]])(
		'%j → 24-hour: %s',
		(value, expected) => {
			expect(clock(value).clock24).toBe(expected);
			expect(clock(value).warnings).toEqual([]);
		},
	);

	it('defaults to 12-hour', () => expect(readWorkbook([]).clock24).toBe(false));

	it('warns about anything else', () => {
		expect(clock('military').warnings).toEqual(['Settings: Clock should be 12-hour or 24-hour, not "military".']);
	});
});

describe('yearEndNotice', () => {
	// The fixture's Last day is 6/3/2027.
	it('says nothing until three weeks before the Last day', () => {
		expect(yearEndNotice(wb, '2027-05-12')).toBeNull();
		expect(yearEndNotice(readWorkbook([]), '2027-06-03')).toBeNull();
	});

	it('warns from three weeks before through the Last day', () => {
		for (const today of ['2027-05-13', '2027-06-03']) {
			expect(yearEndNotice(wb, today)).toEqual({
				ended: false,
				message:
					'The school year ends on 6/3/2027. Before the next one starts, update the First day and Last day on the Settings tab and replace the Special Days.',
			});
		}
	});

	it('says the year is over after the Last day', () => {
		expect(yearEndNotice(wb, '2027-06-04')).toMatchObject({ ended: true });
		expect(yearEndNotice(wb, '2027-08-01')?.message).toMatch(/^The school year ended on 6\/3\/2027, so every day now shows "No school"\./);
	});
});

describe('mistakes become warnings, never errors', () => {
	const settings = (...rows: string[][]): Tab => ({ name: 'Settings', rows: [['Setting', 'Value'], ...rows] });
	const schedule = (name: string, ...rows: string[][]): Tab => ({ name, rows: [['Period', 'Start', 'End'], ...rows] });
	const special = (...rows: string[][]): Tab => ({ name: 'Special Days', rows: [['Date', 'End Date', 'Schedule', 'Note'], ...rows] });
	const regular = schedule('Regular', ['1', '8:00 AM', '9:00 AM'], ['2', '9:05 AM', '10:00 AM']);
	const warningsFor = (...tabs: Tab[]) => readWorkbook(tabs).warnings;

	it('a schedule name with no tab', () => {
		const wb = readWorkbook([settings(['Monday', 'Reguler']), regular, special(['9/8/2026', '', 'Minimun Day', ''])]);
		expect(wb.warnings).toEqual([
			'Settings: Monday uses "Reguler", but there\'s no tab with that name.',
			'Special Days uses "Minimun Day" on 9/8/2026, but there\'s no tab with that name.',
		]);
		expect(resolveDay(wb, '2026-09-08')).toMatchObject({ status: 'unconfigured', label: 'Minimun Day' });
	});

	it('matches schedule names loosely', () => {
		const wb = readWorkbook([settings(['Monday', '  regular ']), regular]);
		expect(wb.warnings).toEqual([]);
		expect(resolveDay(wb, '2026-09-14').scheduleName).toBe('Regular');
	});

	it('a time that can\'t be read skips just that row', () => {
		const wb = readWorkbook([settings(), schedule('Regular', ['1', '8:00 AM', '9:00 AM'], ['2', '9:05', 'ten'])]);
		expect(wb.warnings).toEqual([
			'"Regular" tab, row 3: couldn\'t read the time "ten". Use a time like 8:30 or 1:45 PM.',
		]);
		expect(wb.schedules.get('regular')?.blocks).toHaveLength(1);
	});

	it('a period that ends before it starts', () => {
		expect(warningsFor(settings(), schedule('Regular', ['1', '9:00 AM', '8:00 AM']))).toContain(
			'"Regular" tab, row 2: Period 1 ends (8:00 AM) before it starts (9:00 AM).',
		);
	});

	it('overlapping periods (staff rows may overlap)', () => {
		const tab: Tab = {
			name: 'Regular',
			rows: [
				['Period', 'Start', 'End', 'Type'],
				['Staff Meeting', '7:30 AM', '8:30 AM', 'Staff'],
				['1', '8:00 AM', '9:00 AM', ''],
				['2', '8:55 AM', '10:00 AM', ''],
			],
		};
		expect(warningsFor(settings(), tab)).toEqual(['"Regular" tab: Period 2 starts before Period 1 ends. Check the times.']);
	});

	it('a time zone that isn\'t one', () => {
		const wb = readWorkbook([settings(['Time zone', 'Pacific Time']), regular]);
		expect(wb.timeZone).toBeNull();
		expect(wb.warnings).toEqual(['Settings: "Pacific Time" isn\'t a time zone name. Use one like America/New_York or Europe/London.']);
	});

	it('a date listed twice keeps the first', () => {
		const wb = readWorkbook([
			settings(),
			regular,
			special(['9/7/2026', '', 'No School', 'Labor Day'], ['9/7/2026', '', 'Regular', '']),
		]);
		expect(wb.warnings).toEqual(['"Special Days" row 3: 9/7/2026 is listed more than once; using the first.']);
		expect(resolveDay(wb, '2026-09-07').status).toBe('no-school');
	});

	it('a missing Settings tab', () => {
		expect(warningsFor(regular)).toEqual(['There\'s no "Settings" tab, so no weekday has a normal schedule.']);
	});
});
