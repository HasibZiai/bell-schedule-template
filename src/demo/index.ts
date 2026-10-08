// The built-in demo school (schools.config.ts → sheet: 'demo'). These CSVs have the same tabs as the
// Google Sheets template, so they also serve as its starting content.

import { parseCsv, type Tab } from '../lib/google';
import instructions from './Instructions.csv?raw';
import lateStart from './Late Start.csv?raw';
import minimumDay from './Minimum Day.csv?raw';
import rally from './Rally.csv?raw';
import regular from './Regular.csv?raw';
import settings from './Settings.csv?raw';
import specialDays from './Special Days.csv?raw';

const files: [string, string][] = [
	['Instructions', instructions],
	['Settings', settings],
	['Special Days', specialDays],
	['Regular', regular],
	['Late Start', lateStart],
	['Minimum Day', minimumDay],
	['Rally', rally],
];

export const demoTabs = (): Tab[] => files.map(([name, csv]) => ({ name, rows: parseCsv(csv.trim()) }));
