import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { HttpError, type HttpGetBuffer } from './http.ts';

const execFile = promisify(execFileCallback);

export async function downloadZip(params: {
	url: string;
	headers?: Record<string, string>;
	destPath: string;
	getBuffer: HttpGetBuffer;
}): Promise<void> {
	const response = await params.getBuffer(params.url, {
		headers: params.headers,
	});

	if (!response.ok) {
		throw new HttpError(
			`${String(response.status)} failed to download ${params.url}`,
			response.status,
		);
	}

	const destDir = path.resolve(path.dirname(params.destPath));
	const destPath = path.join(destDir, path.basename(params.destPath));
	await mkdir(destDir, { recursive: true });

	const file = await open(destPath, 'w', 0o600);
	try {
		await file.writeFile(response.body);
	} finally {
		await file.close();
	}
}

export async function unzipTo(zipPath: string, destDir: string): Promise<void> {
	await mkdir(destDir, { recursive: true });
	await execFile('unzip', ['-o', '-q', zipPath, '-d', destDir]);
}

export async function findFileNamed(
	rootDir: string,
	fileName: string,
): Promise<string | null> {
	const entries = await readdir(rootDir, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(rootDir, entry.name);

		if (entry.isFile() && entry.name === fileName) {
			return fullPath;
		}

		if (entry.isDirectory()) {
			const nested = await findFileNamed(fullPath, fileName);

			if (nested) {
				return nested;
			}
		}
	}

	return null;
}
