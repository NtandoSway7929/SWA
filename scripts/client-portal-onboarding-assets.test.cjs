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

assert.match(
  onboarding,
  /async function uploadSelectedAssets\(\)/,
  "selected onboarding assets must have a shared upload routine"
);
assert.match(
  onboarding,
  /upload-client-onboarding-assets/,
  "onboarding assets must be sent to the token-authenticated upload endpoint"
);
assert.match(
  onboarding,
  /if\(assetInput\?\.files\?\.length\)[\s\S]*?await uploadSelectedAssets\(\)[\s\S]*?await saveOnboarding\(true,false\)/,
  "selected assets must upload before the final onboarding submission"
);
assert.match(
  onboarding,
  /Your onboarding has not been submitted because the selected assets could not be uploaded/,
  "onboarding submission must be blocked when selected assets fail to upload"
);
assert.match(
  onboarding,
  /onboardingSubmitInProgress/,
  "duplicate final submissions must be prevented while assets upload"
);
assert.match(
  portal,
  /uploaded automatically when you submit your onboarding/i,
  "the upload instructions must explain automatic attachment on submit"
);

const adminStart = admin.indexOf("async function openClientOnboarding(clientId)");
const adminEnd = admin.indexOf("\n    function clientHealth(", adminStart);
assert.ok(adminStart >= 0 && adminEnd > adminStart, "admin onboarding modal must exist");
const adminOnboarding = admin.slice(adminStart, adminEnd);
assert.match(
  adminOnboarding,
  /client_onboarding_assets\?select=\*&client_id=eq\./,
  "opening onboarding must refresh this client's uploaded assets from Supabase"
);
assert.match(
  adminOnboarding,
  /state\.clientOnboardingAssets[\s\S]*?concat\(latestAssets\)/,
  "fresh asset records must replace stale records for the selected client"
);
assert.match(
  adminOnboarding,
  /data-open-onboarding-asset=/,
  "uploaded assets must remain available to open from the admin onboarding modal"
);
assert.match(
  adminOnboarding,
  /storage\/v1\/object\/sign\/swayphics-client-files/,
  "admin asset access must use a signed URL from the existing private bucket"
);

console.log("Client onboarding asset delivery tests passed.");
