import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BRAND_ASSET_PATHS } from "../src/lib/brand-assets.ts";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("brand images use the generated assets directory", () => {
  assert.equal(BRAND_ASSET_PATHS.logo, "/assets/brand/logo.png");
  assert.equal(BRAND_ASSET_PATHS.favicon, "/assets/brand/favicon.png");

  for (const component of ["Sidebar.tsx", "AuthGate.tsx", "OnboardingOverlay.tsx"]) {
    const contents = source(`../src/components/${component}`);
    assert.match(contents, /BRAND_ASSET_PATHS\.logo/);
    assert.doesNotMatch(contents, /src="\/logo\.png"/);
  }
});

test("the document favicon and service-worker shell use generated brand assets", () => {
  const index = source("../index.html");
  const worker = source("../public/sw.js");

  assert.match(index, new RegExp(`href="${BRAND_ASSET_PATHS.favicon}"`));
  assert.match(worker, new RegExp(BRAND_ASSET_PATHS.logo.replaceAll("/", "\\/")));
});
