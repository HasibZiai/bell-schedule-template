// Mistakes in src/schools.config.ts that would otherwise fail confusingly (a school that can't be reached,
// or two sharing an address). The tests run this on the real config, so CI catches them before deploying;
// the home page lists them too.

import type { SchoolConfig } from '../schools.config';
import { sheetIdOf } from './google';

/** Paths the site itself uses. */
const RESERVED = ['api'];

export function schoolProblems(schools: SchoolConfig[]): string[] {
	const problems: string[] = [];
	const seen = new Set<string>();
	for (const { slug, sheet } of schools) {
		if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
			problems.push(`"${slug}" can't be a school's address. Use lowercase letters, numbers and dashes, like "lakeside-high".`);
		} else if (RESERVED.includes(slug)) {
			problems.push(`"${slug}" is used by the site itself. Pick another address for this school.`);
		}
		if (seen.has(slug.toLowerCase())) problems.push(`More than one school uses the address "${slug}".`);
		seen.add(slug.toLowerCase());
		if (sheet !== 'demo' && !sheetIdOf(sheet)) {
			problems.push(`The sheet for "${slug}" isn't a Google Sheets link: "${sheet}".`);
		}
	}
	return problems;
}
