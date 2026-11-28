const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const script = path.join(__dirname, "audit-host-apparmor.sh");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bof-apparmor-audit-"));
const commandNames = ["cat", "grep", "head", "tr"];

function runAudit({
  enabled = "Y",
  profile = "swayphics-bof-crawl4ai (enforce)",
  restriction = "1",
  parser = true,
} = {}) {
  const fixture = fs.mkdtempSync(path.join(tempRoot, "case-"));
  const bin = path.join(fixture, "bin");
  fs.mkdirSync(bin);
  for (const command of commandNames) {
    const resolved = spawnSync("/bin/sh", ["-c", "command -v " + command], { encoding: "utf8" }).stdout.trim();
    assert.ok(resolved, "test prerequisite missing: " + command);
    fs.symlinkSync(resolved, path.join(bin, command));
  }
  if (parser) {
    const parserPath = path.join(bin, "apparmor_parser");
    fs.writeFileSync(parserPath, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(parserPath, 0o755);
  }

  const enabledFile = path.join(fixture, "apparmor-enabled");
  const profilesFile = path.join(fixture, "apparmor-profiles");
  const restrictionFile = path.join(fixture, "userns-restriction");
  fs.writeFileSync(enabledFile, enabled + "\n");
  fs.writeFileSync(profilesFile, profile ? profile + "\n" : "");
  fs.writeFileSync(restrictionFile, restriction + "\n");

  const result = spawnSync("/bin/bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: bin,
      BOF_APPARMOR_ENABLED_FILE: enabledFile,
      BOF_APPARMOR_PROFILES_FILE: profilesFile,
      BOF_USERNS_RESTRICTION_FILE: restrictionFile,
    },
  });
  return { ...result, output: (result.stdout || "") + (result.stderr || "") };
}

try {
  const passing = runAudit();
  assert.equal(passing.status, 0, passing.output);
  assert.match(passing.output, /AppArmor kernel module: enabled/);
  assert.match(passing.output, /Crawl4AI AppArmor profile: loaded and enforced/);
  assert.match(passing.output, /Unprivileged user-namespace restriction: enabled/);
  assert.match(passing.output, /AppArmor host preflight: PASS/);
  console.log("PASS: AppArmor host audit accepts the loaded enforced profile and enabled userns restriction.");

  const missingProfile = runAudit({ profile: "" });
  assert.equal(missingProfile.status, 2, missingProfile.output);
  assert.match(missingProfile.output, /Crawl4AI AppArmor profile: NOT LOADED/);
  console.log("PASS: AppArmor host audit fails closed when the named profile is absent.");

  const complainProfile = runAudit({ profile: "swayphics-bof-crawl4ai (complain)" });
  assert.equal(complainProfile.status, 2, complainProfile.output);
  assert.match(complainProfile.output, /not in enforce mode/);
  console.log("PASS: AppArmor host audit rejects complain mode.");

  const restrictionDisabled = runAudit({ restriction: "0" });
  assert.equal(restrictionDisabled.status, 2, restrictionDisabled.output);
  assert.match(restrictionDisabled.output, /expected 1, found 0/);
  console.log("PASS: AppArmor host audit rejects a disabled unprivileged-userns restriction.");

  const apparmorDisabled = runAudit({ enabled: "N" });
  assert.equal(apparmorDisabled.status, 2, apparmorDisabled.output);
  assert.match(apparmorDisabled.output, /AppArmor kernel module: INCOMPLETE/);
  console.log("PASS: AppArmor host audit rejects a disabled AppArmor kernel module.");

  const parserMissing = runAudit({ parser: false });
  assert.equal(parserMissing.status, 2, parserMissing.output);
  assert.match(parserMissing.output, /apparmor_parser is unavailable/);
  console.log("PASS: AppArmor host audit rejects a missing profile parser.");

  console.log("BOF AppArmor host audit regression tests passed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
