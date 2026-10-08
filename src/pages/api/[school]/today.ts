import type { APIRoute } from 'astro';
import { findSchool, loadSchool } from '../../../lib/school';
import { isIsoDate, zonedNow } from '../../../lib/time';
import type { TodayResponse } from '../../../lib/types';
import { resolveDay } from '../../../lib/workbook';

export const prerender = false;

// GET /api/<school>/today                 → today's schedule in the school's timezone
// GET /api/<school>/today?date=2026-10-23 → any date (used by the display's ?date= and for testing)
export const GET: APIRoute = async ({ params, url }) => {
	const config = findSchool(params.school);
	if (!config) return Response.json({ error: `No school "${params.school}".` }, { status: 404 });

	const school = await loadSchool(config);
	const requested = url.searchParams.get('date');
	const date = isIsoDate(requested) ? requested : zonedNow(school.timeZone).date;
	const body: TodayResponse = {
		school: school.name,
		timeZone: school.timeZone,
		clock24: school.workbook.clock24,
		generatedAt: new Date().toISOString(),
		stale: school.stale,
		day: resolveDay(school.workbook, date),
	};

	// Not cached: the display sets its clock from generatedAt, so the response must be fresh. (The sheet
	// itself is cached in loadSchool, so this doesn't add requests to Google.)
	return Response.json(body, {
		headers: { 'Cache-Control': 'no-store' },
	});
};
