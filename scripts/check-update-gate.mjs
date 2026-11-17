/**
 * Plain-Node checks for lib/updateDecision.ts (the "please update" gate,
 * 2026-11-17).
 *
 *   node scripts/check-update-gate.mjs
 *
 * Needs a Node version that runs TypeScript files directly (22.18+ or 23.6+).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideUpdate, parseBuildNumber, DEFAULT_UPDATE_MESSAGE, PLAY_STORE_URL } from "../lib/updateDecision.ts";

const row = (min_build, message = null, store_url = null) => ({ min_build, message, store_url });

test("a build below the minimum is asked to update, with the default words and Play link", () => {
  assert.deepEqual(decideUpdate(4, row(9)), { required: true, message: DEFAULT_UPDATE_MESSAGE, storeUrl: PLAY_STORE_URL });
});

test("the row's own words and link win when set", () => {
  assert.deepEqual(decideUpdate(4, row(9, " Update for new orders ", "https://example.com/x")), {
    required: true,
    message: "Update for new orders",
    storeUrl: "https://example.com/x",
  });
});

test("the minimum build and anything newer go through", () => {
  assert.deepEqual(decideUpdate(9, row(9)), { required: false });
  assert.deepEqual(decideUpdate(10, row(9)), { required: false });
});

test("fails open: 0 / missing minimum, no row, unknown build", () => {
  assert.deepEqual(decideUpdate(1, row(0)), { required: false });
  assert.deepEqual(decideUpdate(1, row(null)), { required: false });
  assert.deepEqual(decideUpdate(1, null), { required: false });
  assert.deepEqual(decideUpdate(null, row(9)), { required: false });
});

test("build numbers: positive integers only", () => {
  assert.equal(parseBuildNumber("8"), 8);
  assert.equal(parseBuildNumber(null), null);
  assert.equal(parseBuildNumber(""), null);
  assert.equal(parseBuildNumber("1.0"), 1);
  assert.equal(parseBuildNumber("abc"), null);
  assert.equal(parseBuildNumber("0"), null);
});
