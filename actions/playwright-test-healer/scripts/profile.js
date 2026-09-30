'use strict';

/**
 * Everything that differs between healing Core and healing Pro — which runs
 * hold evidence, how shard artifacts are named, how each shard is run — lives
 * in one JSON profile per product, so the scripts stay product-agnostic.
 */

const fs = require('fs');
const path = require('path');

const SUPPORTED_PRODUCTS = ['core', 'pro'];
const PROFILES_DIR = path.join(__dirname, '..', 'profiles');

function loadProfile(product = process.env.HEALER_PRODUCT) {
	if (!SUPPORTED_PRODUCTS.includes(product)) {
		throw new Error(
			`HEALER_PRODUCT must be one of ${SUPPORTED_PRODUCTS.join(', ')}, got "${product || ''}".`,
		);
	}

	return JSON.parse(
		fs.readFileSync(path.join(PROFILES_DIR, `${product}.json`), 'utf8'),
	);
}

module.exports = { SUPPORTED_PRODUCTS, loadProfile };
