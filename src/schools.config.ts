// The schools this deployment serves. Each school is one Google Sheet made from the template
// (see README → "Adding a school"). The slug is the school's address: /lakeside, /lakeside/preview.
//
// sheet: the sheet's link, shared as "Anyone with the link can view".
//        'demo' uses the built-in sample schedule in src/demo/ (handy for trying things out).

export interface SchoolConfig {
	slug: string;
	sheet: string;
}

export const schools: SchoolConfig[] = [
	{ slug: 'demo', sheet: 'demo' },
	// { slug: 'lakeside', sheet: 'https://docs.google.com/spreadsheets/d/…/edit' },
];
