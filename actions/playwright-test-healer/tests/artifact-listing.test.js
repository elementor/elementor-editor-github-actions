'use strict';

const {
	listZipEntries,
	resultDirsFromEntries,
} = require('../scripts/artifact-listing');

/**
 * The tail of a zip: `dataLength` bytes of file data, then a central
 * directory naming `names`, then the end-of-central-directory record. That is
 * all a listing reads.
 */
function buildZip(names, dataLength) {
	const entries = names.map((name) => {
		const nameBytes = Buffer.from(name, 'utf8');
		const header = Buffer.alloc(46);
		header.writeUInt32LE(0x02014b50, 0);
		header.writeUInt16LE(nameBytes.length, 28);
		return Buffer.concat([header, nameBytes]);
	});
	const centralDirectory = Buffer.concat(entries);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(names.length, 8);
	end.writeUInt16LE(names.length, 10);
	end.writeUInt32LE(centralDirectory.length, 12);
	end.writeUInt32LE(dataLength, 16);

	return Buffer.concat([Buffer.alloc(dataLength), centralDirectory, end]);
}

function rangeReaderFor(zip) {
	const reads = [];
	const read = (start, end) => {
		reads.push([start, end]);
		return zip.subarray(start, end + 1);
	};
	read.reads = reads;
	return read;
}

const NAMES = [
	'suite-has-trace/trace.zip',
	'suite-has-trace/error-context.md',
	'suite-retried/retry1/trace.zip',
	'suite-log-only/error-context.md',
];

describe('listZipEntries', () => {
	it('reads the names from the last 64 KB in one request', () => {
		// Arrange
		const zip = buildZip(NAMES, 5 * 1024 * 1024);
		const read = rangeReaderFor(zip);

		// Act
		const names = listZipEntries(zip.length, read);

		// Assert
		expect(names).toEqual(NAMES);
		expect(read.reads).toEqual([[zip.length - 65536, zip.length - 1]]);
	});

	it('reads a central directory larger than the tail with a second request', () => {
		// Arrange
		const many = Array.from(
			{ length: 1500 },
			(_, i) => `suite-${i}-${'x'.repeat(40)}/trace.zip`,
		);
		const zip = buildZip(many, 1024);
		const read = rangeReaderFor(zip);

		// Act
		const names = listZipEntries(zip.length, read);

		// Assert
		expect(names).toHaveLength(1500);
		expect(read.reads).toHaveLength(2);
		expect(read.reads[1][0]).toBe(1024);
	});

	it('reads a zip smaller than the tail from its start', () => {
		// Arrange
		const zip = buildZip(NAMES, 10);
		const read = rangeReaderFor(zip);

		// Act & Assert
		expect(listZipEntries(zip.length, read)).toEqual(NAMES);
		expect(read.reads).toEqual([[0, zip.length - 1]]);
	});

	it('fails on bytes that are not a zip', () => {
		const junk = Buffer.alloc(100);
		expect(() => listZipEntries(junk.length, () => junk)).toThrow(
			'No zip end-of-central-directory record found',
		);
	});
});

describe('resultDirsFromEntries', () => {
	it('lists top-level directories and finds traces at any depth', () => {
		expect(resultDirsFromEntries(NAMES)).toEqual([
			{ dirName: 'suite-has-trace', hasTrace: true },
			{ dirName: 'suite-retried', hasTrace: true },
			{ dirName: 'suite-log-only', hasTrace: false },
		]);
	});

	it('ignores files at the zip root', () => {
		expect(resultDirsFromEntries(['.last-run.json'])).toEqual([]);
	});
});
