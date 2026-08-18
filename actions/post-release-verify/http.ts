export class HttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

export type HttpGet = (
	url: string,
	init?: { headers?: Record<string, string> },
) => Promise<{ status: number; body: string; ok: boolean }>;

export type HttpGetBuffer = (
	url: string,
	init?: { headers?: Record<string, string> },
) => Promise<{ status: number; body: Buffer; ok: boolean }>;

export function createFetchGet(): HttpGet {
	return async (url, init) => {
		const response = await fetch(url, {
			headers: init?.headers,
			redirect: 'follow',
		});

		return {
			status: response.status,
			ok: response.ok,
			body: await response.text(),
		};
	};
}

export function createFetchGetBuffer(): HttpGetBuffer {
	return async (url, init) => {
		const response = await fetch(url, {
			headers: init?.headers,
			redirect: 'follow',
		});

		return {
			status: response.status,
			ok: response.ok,
			body: Buffer.from(await response.arrayBuffer()),
		};
	};
}

export async function requireOk(
	get: HttpGet,
	url: string,
	init?: { headers?: Record<string, string> },
): Promise<string> {
	const response = await get(url, init);

	if (!response.ok) {
		throw new HttpError(
			`${String(response.status)} ${url}: ${response.body.slice(0, 300)}`,
			response.status,
		);
	}

	return response.body;
}
