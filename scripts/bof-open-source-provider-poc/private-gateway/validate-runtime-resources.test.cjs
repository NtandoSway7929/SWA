const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const validator = path.join(__dirname, "validate-runtime-resources.py");
const mib = 1024 ** 2;
const gib = 1024 ** 3;
const expected = {
  searxng: { memory: gib, nano_cpus: 750000000, pids: 256 },
  crawl4ai: { memory: 4 * gib, nano_cpus: 1500000000, pids: 512 },
  valkey: { memory: 384 * mib, nano_cpus: 250000000, pids: 128 },
  gateway: { memory: 256 * mib, nano_cpus: 250000000, pids: 128 },
  cloudflared: { memory: 128 * mib, nano_cpus: 250000000, pids: 128 },
};

function run(service, overrides = {}) {
  const values = { ...expected[service], ...overrides };
  const inspected = [{ HostConfig: {
    Memory: values.memory,
    NanoCpus: values.nano_cpus,
    PidsLimit: values.pids,
  } }];
  return spawnSync("python3", [validator, "--service", service], {
    input: JSON.stringify(inspected),
    encoding: "utf8",
  });
}

for (const service of Object.keys(expected)) {
  const valid = run(service);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /CPU, memory and PID ceilings are enforced/);
  console.log("PASS: " + service + " accepts exact Docker runtime resource limits.");
}

for (const [key, badValue] of [["memory", 1], ["nano_cpus", 1], ["pids", 1]]) {
  const invalid = run("crawl4ai", { [key]: badValue });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /runtime .* limit must be/);
  console.log("PASS: altered runtime " + key + " ceiling is rejected.");
}

const missing = spawnSync("python3", [validator, "--service", "gateway"], {
  input: JSON.stringify([{ HostConfig: { Memory: 268435456, NanoCpus: 250000000 } }]),
  encoding: "utf8",
});
assert.equal(missing.status, 1);
assert.match(missing.stderr, /runtime pids limit is not set/);
console.log("PASS: missing runtime PID limit is rejected.");

console.log("BOF runtime Docker resource verifier regression tests passed.");
