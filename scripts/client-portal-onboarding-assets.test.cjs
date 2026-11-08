"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const portal = fs.readFileSync(path.join(root, "client-portal", "index.html"), "utf8");
const admin = fs.readFileSync(path.join(root, "admin-dashboard", "admin-workspace.js"), "utf8");

const onboardingStart = portal.indexOf("function bindOnboarding()");
const onboardingEnd = portal.indexOf("\nfunction financialMoney", onboardingStart);
assert.ok(onboardingStart >= 0 && onboardingEnd > onboardingStart, "onboarding controller must exist");
const onboarding = portal.slice(onboardingStart, onboardingEnd);

assert.match(onboarding, /async function uploadSelectedAssets\(\)/);
assert.match(onboarding, /upload-client-onboarding-assets/);
assert.match(
  onboarding,
  /if\(assetInput\?\.files\?\.length\)[\s\S]*?await uploadSelectedAssets\(\)[\s\S]*?await saveOnboarding\(true,false\)/,
  "selected assets must upload before the final onboarding submission"
);
assert.match(
  onboarding,
  /Your onboarding has not been submitted because the selected assets could not be uploaded/,
  "submission must be blocked if selected assets fail to upload"
);
assert.match(onboarding, /onboardingSubmitInProgress/);
assert.match(portal, /uploaded automatically when you submit your onboarding/i);

const adminStart = admin.indexOf("async function openClientOnboarding(clientId)");
const adminEnd = admin.indexOf("\n    function clientHealth(", adminStart);
assert.ok(adminStart >= 0 && adminEnd > adminStart, "admin onboarding modal must exist");
const adminOnboarding = admin.slice(adminStart, adminEnd);
assert.match(adminOnboarding, /client_onboarding_assets\?select=\*&client_id=eq\./);
assert.match(adminOnboarding, /state\.clientOnboardingAssets[\s\S]*?concat\(latestAssets\)/);
assert.match(adminOnboarding, /data-open-onboarding-asset=/);
assert.match(adminOnboarding, /storage\/v1\/object\/sign\/swayphics-client-files/);

console.log("Client onboarding asset delivery tests passed.");
