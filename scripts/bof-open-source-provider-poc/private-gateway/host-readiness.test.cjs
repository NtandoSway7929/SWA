"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const scriptPath = path.join(__dirname, "audit-host-readiness.sh");

function writeExecutable(filePath, lines) {
    fs.writeFileSync(filePath, lines.join("\n") + "\n", { mode: 0o755 });
    fs.chmodSync(filePath, 0o755);
}

function createMockBin() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bof-host-readiness-"));
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);

    writeExecutable(path.join(bin, "docker"), [
        "#!/bin/sh",
        "case \"$*\" in",
        "  info)",
        "    if [ \"${MOCK_DOCKER_BACKEND:-iptables}\" = \"unknown\" ]; then",
        "      echo 'Server Version: test'",
        "    else",
        "      echo 'Server Version: test'",
        "      echo \" Firewall Backend: ${MOCK_DOCKER_BACKEND:-iptables}\"",
        "    fi",
        "    ;;",
        "  'context show') echo 'default' ;;",
        "  'context inspect default')",
        "    if [ \"${MOCK_DOCKER_CONTEXT_REMOTE:-0}\" = \"1\" ]; then",
        "      echo '[{\"Endpoints\":{\"docker\":{\"Host\":\"ssh://user@remote.invalid\"}}}]'",
        "    else",
        "      echo '[{\"Endpoints\":{\"docker\":{\"Host\":\"unix:///var/run/docker.sock\"}}}]'",
        "    fi",
        "    ;;",
        "  'network ls -q') : ;;",
        "  *) echo \"unexpected docker command: $*\" >&2; exit 90 ;;",
        "esac"
    ]);

    writeExecutable(path.join(bin, "ip"), [
        "#!/bin/sh",
        "case \"$*\" in",
        "  '-j address show')",
        "    if [ \"${MOCK_OVERLAP:-0}\" = \"1\" ]; then",
        "      echo '[{\"ifname\":\"test0\",\"addr_info\":[{\"family\":\"inet\",\"local\":\"10.77.40.10\",\"prefixlen\":24}]}]'",
        "    else",
        "      echo '[{\"ifname\":\"lo\",\"addr_info\":[{\"family\":\"inet\",\"local\":\"127.0.0.1\",\"prefixlen\":8}]}]'",
        "    fi",
        "    ;;",
        "  '-j -4 route show table all' | '-j -6 route show table all') echo '[{\"dst\":\"default\"}]' ;;",
        "  *) echo \"unexpected ip command: $*\" >&2; exit 90 ;;",
        "esac"
    ]);

    writeExecutable(path.join(bin, "iptables"), [
        "#!/bin/sh",
        "echo '-P FORWARD DROP'",
        "echo '-N DOCKER-USER'"
    ]);

    writeExecutable(path.join(bin, "ip6tables"), [
        "#!/bin/sh",
        "case \"$*\" in",
        "  '-S DOCKER-USER') echo 'No chain/target/match by that name.' >&2; exit 1 ;;",
        "  *) echo '-P FORWARD DROP' ;;",
        "esac"
    ]);

    writeExecutable(path.join(bin, "sysctl"), [
        "#!/bin/sh",
        "if [ \"${MOCK_SYSCTL_FAIL:-0}\" = \"1\" ]; then echo 'permission denied' >&2; exit 1; fi",
        "case \"$2\" in",
        "  net.ipv4.ip_forward) echo '1' ;;",
        "  net.ipv6.conf.all.forwarding) echo '0' ;;",
        "  *) exit 91 ;;",
        "esac"
    ]);

    writeExecutable(path.join(bin, "nft"), [
        "#!/bin/sh",
        "echo 'table inet filter {'",
        "echo ' chain forward { type filter hook forward priority filter; policy drop; }'",
        "echo '}'"
    ]);

    return { root, bin };
}

function runCase({ variables = {}, args = [], setDockerHost = false } = {}) {
    const fixture = createMockBin();
    const env = {
        ...process.env,
        PATH: fixture.bin + path.delimiter + process.env.PATH,
        ...variables
    };
    delete env.DOCKER_HOST;
    delete env.DOCKER_CONTEXT;
    if (setDockerHost) env.DOCKER_HOST = "tcp://remote.invalid:2376";

    try {
        return spawnSync("bash", [scriptPath, ...args], {
            encoding: "utf8",
            env,
            timeout: 15000
        });
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
}

const clean = runCase();
assert.equal(clean.status, 0, clean.stderr || clean.stdout);
assert.match(clean.stdout, /Docker firewall backend: PASS \(iptables\)/);
assert.match(clean.stdout, /Host subnet-overlap audit: PASS/);
assert.match(clean.stdout, /Firewall and forwarding snapshot: READABLE/);
assert.match(clean.stdout, /IPv4 forwarding sysctl: 1/);
assert.match(clean.stdout, /IPv6 forwarding sysctl: 0/);
assert.match(clean.stdout, /DEPLOYMENT GATE: NOT READY/);
assert.match(clean.stdout, /Raw host details: suppressed/);
assert.doesNotMatch(clean.stdout, /10\.77\.40\.10|unix:\/\/\/var\/run/);
console.log("PASS clean read-only inventory is reported without raw host details");

const conflict = runCase({ variables: { MOCK_OVERLAP: "1" } });
assert.equal(conflict.status, 1, conflict.stderr || conflict.stdout);
assert.match(conflict.stdout, /Host subnet-overlap audit: CONFLICT/);
assert.match(conflict.stdout, /DEPLOYMENT GATE: NOT READY/);
assert.doesNotMatch(conflict.stdout, /10\.77\.40\.10/);
console.log("PASS detected subnet conflicts block the inventory result without leaking addresses");

const incompleteContext = runCase({ setDockerHost: true });
assert.equal(incompleteContext.status, 2, incompleteContext.stderr || incompleteContext.stdout);
assert.match(incompleteContext.stdout, /Host subnet-overlap audit: INCOMPLETE/);
assert.match(incompleteContext.stdout, /DEPLOYMENT GATE: NOT READY/);
console.log("PASS unsafe Docker endpoint overrides fail closed");

const incompleteSnapshot = runCase({ variables: { MOCK_SYSCTL_FAIL: "1" } });
assert.equal(incompleteSnapshot.status, 2, incompleteSnapshot.stderr || incompleteSnapshot.stdout);
assert.match(incompleteSnapshot.stdout, /Firewall and forwarding snapshot: INCOMPLETE/);
console.log("PASS unreadable forwarding settings make the host report incomplete");

const unknownBackend = runCase({ variables: { MOCK_DOCKER_BACKEND: "unknown" } });
assert.equal(unknownBackend.status, 2, unknownBackend.stderr || unknownBackend.stdout);
assert.match(unknownBackend.stdout, /Docker firewall backend: INCOMPLETE/);
assert.match(unknownBackend.stdout, /Firewall and forwarding snapshot: SKIPPED/);
console.log("PASS unsupported firewall backends fail closed and skip state capture");

const remoteContext = runCase({ variables: { MOCK_DOCKER_CONTEXT_REMOTE: "1" } });
assert.equal(remoteContext.status, 2, remoteContext.stderr || remoteContext.stdout);
assert.match(remoteContext.stdout, /Host subnet-overlap audit: INCOMPLETE/);
console.log("PASS remote Docker contexts are not accepted as local-host inventory");

const details = runCase({ args: ["--show-details"] });
assert.equal(details.status, 0, details.stderr || details.stdout);
assert.match(details.stdout, /Raw host details: included below/);
assert.match(details.stdout, /Verified Docker context:/);
assert.match(details.stdout, /IPv6 DOCKER-USER chain/);
console.log("PASS raw host details require explicit opt-in");

const unknownOption = runCase({ args: ["--apply"] });
assert.equal(unknownOption.status, 3);
assert.match(unknownOption.stderr, /Unknown option/);
console.log("PASS unsupported options cannot invoke an apply mode");

console.log("BOF read-only host readiness tests passed.");
