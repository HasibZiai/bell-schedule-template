// Builds template/Bell Schedule Template.xlsx from the demo school's CSVs (src/demo/).
// Upload the .xlsx to Google Drive and open it with Google Sheets to get a ready-made schedule sheet:
// every tab, real time/date cells, and dropdowns for choosing schedules.
//
//   npm run build-template
//
// Written without dependencies: an .xlsx is a zip of a few XML files.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync, crc32 } from 'node:zlib';

const DEMO = new URL('../src/demo/', import.meta.url);
const OUT_DIR = new URL('../template/', import.meta.url);
const OUT = new URL('Bell Schedule Template.xlsx', OUT_DIR);

const parseCsv = (text) => {
	const rows = [];
	let row = [], field = '', quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
			else if (ch === '"') quoted = false;
			else field += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') row.push(field), (field = '');
		else if (ch === '\n') row.push(field), rows.push(row), (row = []), (field = '');
		else if (ch !== '\r') field += ch;
	}
	row.push(field), rows.push(row);
	return rows;
};
const csv = (name) => parseCsv(readFileSync(new URL(`${name}.csv`, DEMO), 'utf8').trim());

// Tab order in the template: instructions and setup first, then the schedules.
const schedules = ['Regular', 'Late Start', 'Minimum Day', 'Rally'];
const tabs = [
	{ name: 'Instructions', rows: csv('Instructions'), widths: [110] },
	{ name: 'Settings', rows: csv('Settings'), widths: [22, 28] },
	{ name: 'Special Days', rows: csv('Special Days'), widths: [14, 14, 18, 40] },
	...schedules.map((name) => ({ name, rows: csv(name), widths: [18, 12, 12, 14] })),
];

// ---- Cell values ---------------------------------------------------------------------------
const TIME = /^(\d{1,2}):(\d{2})\s*([AP])M$/i;
const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const STYLE = { text: 0, header: 1, time: 2, date: 3, title: 4 };

function cellValue(text) {
	let m;
	if ((m = text.match(TIME))) {
		const h = (Number(m[1]) % 12) + (m[3].toUpperCase() === 'P' ? 12 : 0);
		return { number: (h * 60 + Number(m[2])) / 1440, style: STYLE.time };
	}
	if ((m = text.match(DATE))) {
		const serial = (Date.UTC(+m[3], +m[1] - 1, +m[2]) - Date.UTC(1899, 11, 30)) / 86400000;
		return { number: serial, style: STYLE.date };
	}
	return { text, style: STYLE.text };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => String.fromCharCode(65 + i);
const strings = [];
const stringIndex = new Map();
const sst = (s) => {
	if (!stringIndex.has(s)) stringIndex.set(s, strings.push(s) - 1);
	return stringIndex.get(s);
};

// Dropdowns: schedule names (plus No School) wherever a schedule is chosen, and the clock style.
// "warning" style still lets people type something else, e.g. a new schedule name after adding its tab.
// Settings rows: 1 header, 2 name, 3 time zone, 4 clock, 5 first day, 6 last day, 7–13 Monday–Sunday.
const scheduleList = {
	choices: `"${[...schedules, 'No School'].join(',')}"`,
	title: 'Unknown schedule',
	error: "There's no tab with this name yet. Add a tab for it, or pick one from the list.",
};
const clockList = { choices: '"12-hour,24-hour"', title: 'Clock', error: 'Pick 12-hour or 24-hour.' };
const validations = {
	'Settings': [['B7:B13', scheduleList], ['B4', clockList]],
	'Special Days': [['C2:C400', scheduleList]],
};

function sheetXml(tab) {
	const isInstructions = tab.name === 'Instructions';
	const rows = tab.rows
		.map((cells, r) => {
			const xml = cells
				.map((raw, c) => {
					const text = raw.trim();
					if (!text) return '';
					const ref = `${colName(c)}${r + 1}`;
					const header = r === 0;
					const v = header ? { text, style: isInstructions ? STYLE.title : STYLE.header } : cellValue(text);
					if (v.number !== undefined) return `<c r="${ref}" s="${v.style}"><v>${v.number}</v></c>`;
					return `<c r="${ref}" s="${v.style}" t="s"><v>${sst(v.text)}</v></c>`;
				})
				.join('');
			return `<row r="${r + 1}">${xml}</row>`;
		})
		.join('');
	const cols = tab.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
	const dv = validations[tab.name]
		? `<dataValidations count="${validations[tab.name].length}">${validations[tab.name]
				.map(
					([sqref, list]) =>
						`<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="warning" errorTitle="${esc(list.title)}" error="${esc(list.error)}" sqref="${sqref}"><formula1>${esc(list.choices)}</formula1></dataValidation>`,
				)
				.join('')}</dataValidations>`
		: '';
	const freeze = isInstructions ? '' : '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}<cols>${cols}</cols><sheetData>${rows}</sheetData>${dv}</worksheet>`;
}

const sheets = tabs.map(sheetXml);

const files = {
	'[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${tabs
		.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
		.join('')}</Types>`,
	'_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
	'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tabs
		.map((t, i) => `<sheet name="${esc(t.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
		.join('')}</sheets></workbook>`,
	'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tabs
		.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
		.join('')}<Relationship Id="rId${tabs.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${tabs.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
	'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="h:mm AM/PM"/><numFmt numFmtId="165" formatCode="m/d/yyyy"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F0FD"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="5"><xf fontId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" applyNumberFormat="1"/><xf fontId="2" applyFont="1"/></cellXfs></styleSheet>`,
};
sheets.forEach((xml, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = xml));
files['xl/sharedStrings.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
	.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`)
	.join('')}</sst>`;

// ---- Zip -----------------------------------------------------------------------------------
function zip(entries) {
	const locals = [];
	const centrals = [];
	let offset = 0;
	for (const [name, content] of Object.entries(entries)) {
		const data = Buffer.from(content, 'utf8');
		const packed = deflateRawSync(data);
		const nameBuf = Buffer.from(name, 'utf8');
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt16LE(8, 8); // deflate
		local.writeUInt32LE(0x00210000, 10); // 1980-01-01 00:00
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(packed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(8, 10);
		central.writeUInt32LE(0x00210000, 12);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(packed.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, nameBuf, packed);
		centrals.push(central, nameBuf);
		offset += local.length + nameBuf.length + packed.length;
	}
	const centralDir = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(entries).length, 8);
	end.writeUInt16LE(Object.keys(entries).length, 10);
	end.writeUInt32LE(centralDir.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, centralDir, end]);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, zip(files));
console.log(`Wrote ${decodeURIComponent(OUT.pathname).replace(/^\/([A-Z]:)/, '$1')} (${tabs.map((t) => t.name).join(', ')})`);
