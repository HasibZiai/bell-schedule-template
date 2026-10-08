import { describe, expect, it } from 'vitest';
import { schoolProblems } from '../src/lib/check-schools';
import { schools } from '../src/schools.config';

const SHEET = 'https://docs.google.com/spreadsheets/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789/edit';

describe('schools.config.ts', () => {
	it('has no problems', () => expect(schoolProblems(schools)).toEqual([]));
});

describe('schoolProblems', () => {
	it('accepts good entries', () => {
		expect(schoolProblems([{ slug: 'demo', sheet: 'demo' }, { slug: 'lakeside-high', sheet: SHEET }])).toEqual([]);
	});

	it.each(['Lakeside', 'lakeside high', 'lakeside/high', '-lakeside', ''])('rejects the address %j', (slug) => {
		expect(schoolProblems([{ slug, sheet: SHEET }])).toEqual([
			`"${slug}" can't be a school's address. Use lowercase letters, numbers and dashes, like "lakeside-high".`,
		]);
	});

	it('rejects addresses the site uses', () => {
		expect(schoolProblems([{ slug: 'api', sheet: SHEET }])).toEqual([
			'"api" is used by the site itself. Pick another address for this school.',
		]);
	});

	it('rejects two schools with one address', () => {
		expect(schoolProblems([{ slug: 'lakeside', sheet: SHEET }, { slug: 'lakeside', sheet: 'demo' }])).toEqual([
			'More than one school uses the address "lakeside".',
		]);
	});

	it('rejects a sheet that isn\'t a Google Sheets link', () => {
		expect(schoolProblems([{ slug: 'lakeside', sheet: 'https://example.com/schedule' }])).toEqual([
			'The sheet for "lakeside" isn\'t a Google Sheets link: "https://example.com/schedule".',
		]);
	});
});
