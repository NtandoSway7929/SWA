const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const validator = path.join(__dirname, "validate-compose-resources.py");
const gib = 1024 ** 3;
const mib = 1024 ** 2;
const expected = {
  searxng: { memory: gib, cpus: 0.75, pids: 256 },
  crawl4ai: { memory: 4 * gib, cpus: 1.5, pids: 512 },
  valkey: { memory: 384 * mib, cpus: 0.25, pids: 128 },
  gateway: { memory: 256 * mib, cpus: 0.25, pids: 128 },
  cloudflared: { memory: 128 * mib, cpus: 0.25, pids: 128 },
};

function fixture(overrides = {}) {
  const services = {};
  for (const [name, limits] of Object.entries(expected)) {
    services[name] = {
      deploy: {
        resources: {
          limits: { ...limits, ...(overrides[name] || {}) },
        },
      },
    };
  }
  return { services };
}

function run(document) {
  return spawnSync("python3", [validator], {
    input: JSON.stringify(document),
    encoding: "utf8",
  });
}

const valid = run(fixture());
assert.equal(valid.status, 0, valid.stderr);
assert.match(valid.stdout, /aggregate hard ceilings memory=.*CPUs=3\.75/);
console.log("PASS: exact service and aggregate CPU/memory/PID ceilings are accepted.");

const missingCpu = fixture();
delete missingCpu.services.crawl4ai.deploy.resources.limits.cpus;
const missing = run(missingCpu);
assert.equal(missing.status, 1);
assert.match(missing.stderr, /crawl4ai must define memory, CPU and PID limits/);
console.log("PASS: missing CPU ceiling is rejected.");

const excessiveCpu = fixture({ crawl4ai: { cpus: 2 } });
const cpu = run(excessiveCpu);
assert.equal(cpu.status, 1);
assert.match(cpu.stderr, /crawl4ai CPU limit must be 1.5/);
console.log("PASS: an unexpected per-service CPU ceiling is rejected.");

const excessiveMemory = fixture({ crawl4ai: { memory: 7 * gib } });
const memory = run(excessiveMemory);
assert.equal(memory.status, 1);
assert.match(memory.stderr, /crawl4ai memory limit must be/);
console.log("PASS: an unexpected per-service memory ceiling is rejected.");

const excessivePids = fixture({ searxng: { pids: 1000 } });
const pids = run(excessivePids);
assert.equal(pids.status, 1);
assert.match(pids.stderr, /searxng PID limit must be 256/);
console.log("PASS: an unexpected PID ceiling is rejected.");

console.log("BOF Compose resource validator regression tests passed.");
