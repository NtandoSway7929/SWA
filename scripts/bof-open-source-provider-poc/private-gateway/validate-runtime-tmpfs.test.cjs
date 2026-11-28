const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const validator = path.join(__dirname, "validate-runtime-tmpfs.py");
const mib = 1024 ** 2;
const expected = {
  crawl4ai: {
    "/tmp": 512 * mib,
    "/var/lib/redis": 128 * mib,
    "/var/lib/crawl4ai/outputs": 256 * mib,
    "/home/appuser/.crawl4ai": 64 * mib,
    "/home/appuser/.cache/url_seeder": 64 * mib,
    "/home/appuser/.gunicorn": 64 * mib,
  },
  gateway: { "/data": 32 * mib, "/config": 8 * mib, "/tmp": 32 * mib },
};

function run(service, overrides = {}, omitTarget = null) {
  const tmpfs = {};
  for (const [target, size] of Object.entries(expected[service])) {
    if (target === omitTarget) continue;
    tmpfs[target] = "rw,noexec,nosuid,size=" + (overrides[target] ?? size) + ",mode=0700";
  }
  const inspected = [{ HostConfig: { Tmpfs: tmpfs } }];
  return spawnSync("python3", [validator, "--service", service], {
    input: JSON.stringify(inspected),
    encoding: "utf8",
  });
}

for (const service of Object.keys(expected)) {
  const valid = run(service);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /runtime tmpfs mounts are explicitly size-bounded/);
  console.log("PASS: " + service + " accepts all expected bounded tmpfs mounts.");
}

const missing = run("crawl4ai", {}, "/tmp");
assert.equal(missing.status, 1);
assert.match(missing.stderr, /missing tmpfs mount/);
console.log("PASS: missing tmpfs mounts are rejected.");

const altered = run("crawl4ai", { "/tmp": 1024 * mib });
assert.equal(altered.status, 1);
assert.match(altered.stderr, /tmp must be 536870912 bytes/);
console.log("PASS: altered tmpfs size is rejected.");

const malformed = spawnSync("python3", [validator, "--service", "gateway"], {
  input: JSON.stringify([{ HostConfig: { Tmpfs: { "/data": "rw,mode=0700" } } }]),
  encoding: "utf8",
});
assert.equal(malformed.status, 1);
assert.match(malformed.stderr, /gateway tmpfs \/data has no explicit numeric size/);
console.log("PASS: missing tmpfs mounts are rejected.");

console.log("BOF runtime tmpfs validator regression tests passed.");
