export type CheckStatus = 'pass' | 'fail' | 'skipped' | 'warn';

export type CheckResult = {
	id: string;
	title: string;
	status: CheckStatus;
	detail: string;
};

export function passed(id: string, title: string, detail: string): CheckResult {
	return { id, title, status: 'pass', detail };
}

export function failed(id: string, title: string, detail: string): CheckResult {
	return { id, title, status: 'fail', detail };
}

export function skipped(
	id: string,
	title: string,
	detail: string,
): CheckResult {
	return { id, title, status: 'skipped', detail };
}

export function warned(id: string, title: string, detail: string): CheckResult {
	return { id, title, status: 'warn', detail };
}

export function hasFailedChecks(checks: CheckResult[]): boolean {
	return checks.some((check) => check.status === 'fail');
}
