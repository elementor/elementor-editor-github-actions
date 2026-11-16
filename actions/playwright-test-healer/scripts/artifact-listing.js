'use strict';

/**
 * Lists the files inside an artifact's zip without downloading it.
 *
 * Ranking and evidence search need only a shard's test directory names and
 * whether each has a trace, but a results artifact is mostly traces and
 * videos (20 MB is common). A zip keeps its file list in a central directory
 * at the end, so two small Range requests on the blob GitHub redirects to
 * read the list in kilobytes. Azure Blob ignores suffix ranges
 * (`bytes=-N`), so ranges are explicit, from the artifact's known size.
 */

const { execFileSync } = require('child_process');

const TAIL_BYTES = 64 * 1024;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const EOCD_MIN_LENGTH = 22;
const CENTRAL_ENTRY_FIXED_LENGTH = 46;
const ZIP64_MARKER_16 = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;

function findEndOfCentralDirectory(buffer) {
	for (let i = buffer.length - EOCD_MIN_LENGTH; i >= 0; i--) {
		if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
			const entries = buffer.readUInt16LE(i + 10);
			const size = buffer.readUInt32LE(i + 12);
			const offset = buffer.readUInt32LE(i + 16);

			if (
				ZIP64_MARKER_16 === entries ||
				ZIP64_MARKER_32 === size ||
				ZIP64_MARKER_32 === offset
			) {
				throw new Error('ZIP64 archives are not supported');
			}

			return { entries, size, offset };
		}
	}

	throw new Error('No zip end-of-central-directory record found');
}

function parseCentralDirectory(buffer, expectedEntries) {
	const names = [];
	let position = 0;

	while (
		position + CENTRAL_ENTRY_FIXED_LENGTH <= buffer.length &&
		buffer.readUInt32LE(position) === CENTRAL_ENTRY_SIGNATURE
	) {
		const nameLength = buffer.readUInt16LE(position + 28);
		const extraLength = buffer.readUInt16LE(position + 30);
		const commentLength = buffer.readUInt16LE(position + 32);
		const nameStart = position + CENTRAL_ENTRY_FIXED_LENGTH;

		names.push(buffer.toString('utf8', nameStart, nameStart + nameLength));
		position = nameStart + nameLength + extraLength + commentLength;
	}

	if (names.length !== expectedEntries) {
		throw new Error(
			`Read ${names.length} of ${expectedEntries} zip entries`,
		);
	}

	return names;
}

/**
 * @param {number} totalSize - The zip's size in bytes
 * @param {(start: number, end: number) => Buffer} readRange - Reads bytes
 *   start..end inclusive
 * @returns {string[]} Every entry name in the zip
 */
function listZipEntries(totalSize, readRange) {
	const tailStart = Math.max(0, totalSize - TAIL_BYTES);
	const tail = readRange(tailStart, totalSize - 1);
	const { entries, size, offset } = findEndOfCentralDirectory(tail);

	const centralDirectory =
		offset >= tailStart
			? tail.subarray(offset - tailStart, offset - tailStart + size)
			: readRange(offset, offset + size - 1);

	return parseCentralDirectory(centralDirectory, entries);
}

/**
 * Turns zip entry names into the shape `readResultDirs` produces: one entry
 * per top-level directory, with a trace if any file under it, at any depth
 * (Playwright nests retries as `<dir>/retry1/trace.zip`), is `trace.zip`.
 */
function resultDirsFromEntries(names) {
	const dirs = new Map();

	for (const name of names) {
		const slash = name.indexOf('/');

		if (slash <= 0) {
			continue;
		}

		const dirName = name.slice(0, slash);
		const isTrace = 'trace.zip' === name.split('/').pop();
		dirs.set(dirName, Boolean(dirs.get(dirName)) || isTrace);
	}

	return [...dirs].map(([dirName, hasTrace]) => ({ dirName, hasTrace }));
}

function githubToken() {
	return (
		process.env.GH_TOKEN ||
		process.env.GITHUB_TOKEN ||
		execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
	);
}

/**
 * The artifact zip endpoint answers with a redirect to a short-lived signed
 * blob URL. The token goes to curl on stdin, not argv, so it never shows in
 * the process list.
 */
function resolveArtifactBlobUrl(repo, artifactId) {
	const url = execFileSync(
		'curl',
		[
			'--silent',
			'--show-error',
			'--fail',
			'--output',
			'/dev/null',
			'--write-out',
			'%{redirect_url}',
			'--header',
			'@-',
			`https://api.github.com/repos/${repo}/actions/artifacts/${artifactId}/zip`,
		],
		{
			input: `Authorization: Bearer ${githubToken()}\nAccept: application/vnd.github+json\n`,
			encoding: 'utf8',
		},
	).trim();

	if (!url) {
		throw new Error(`No download redirect for artifact ${artifactId}`);
	}

	return url;
}

function curlRangeReader(blobUrl) {
	return (start, end) => {
		const bytes = execFileSync(
			'curl',
			[
				'--silent',
				'--show-error',
				'--fail',
				'--range',
				`${start}-${end}`,
				blobUrl,
			],
			{ maxBuffer: 64 * 1024 * 1024 },
		);

		if (bytes.length !== end - start + 1) {
			throw new Error(
				`Range ${start}-${end} returned ${bytes.length} bytes; the server ignored the range`,
			);
		}

		return bytes;
	};
}

/**
 * The result directories of one artifact, read from its zip listing.
 *
 * @param {string} repo
 * @param {{id: number, size_in_bytes: number}} artifact
 * @returns {Array<{dirName: string, hasTrace: boolean}>}
 */
function listArtifactResultDirs(repo, artifact) {
	if (!(artifact.size_in_bytes > 0)) {
		throw new Error(`Artifact ${artifact.id} has no known size`);
	}

	const readRange = curlRangeReader(
		resolveArtifactBlobUrl(repo, artifact.id),
	);
	return resultDirsFromEntries(
		listZipEntries(artifact.size_in_bytes, readRange),
	);
}

module.exports = {
	listArtifactResultDirs,
	listZipEntries,
	resultDirsFromEntries,
};
