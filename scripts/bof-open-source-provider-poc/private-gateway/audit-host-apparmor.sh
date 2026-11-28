#!/usr/bin/env bash
set -uo pipefail

# Read-only check of the dedicated Crawl4AI AppArmor profile and userns policy.
profile_name="swayphics-bof-crawl4ai"
enabled_file="${BOF_APPARMOR_ENABLED_FILE:-/sys/module/apparmor/parameters/enabled}"
profiles_file="${BOF_APPARMOR_PROFILES_FILE:-/sys/kernel/security/apparmor/profiles}"
restriction_file="${BOF_USERNS_RESTRICTION_FILE:-/proc/sys/kernel/apparmor_restrict_unprivileged_userns}"

status=0
echo "BOF Crawl4AI AppArmor host audit (read-only)"

if [[ -r "$enabled_file" ]]; then
    enabled="$(tr -d '\n' < "$enabled_file")"
    if [[ "$enabled" == "Y" ]]; then
        echo "AppArmor kernel module: enabled"
    else
        echo "AppArmor kernel module: INCOMPLETE (reported $enabled)"
        status=2
    fi
else
    echo "AppArmor kernel module: INCOMPLETE (kernel status is unavailable)"
    status=2
fi

profiles_content=""
profiles_read=false
if [[ -r "$profiles_file" ]]; then
    if profiles_content="$(cat "$profiles_file" 2>/dev/null)"; then
        profiles_read=true
    fi
fi
if [[ "$profiles_read" != true ]] && command -v sudo >/dev/null 2>&1; then
    if profiles_content="$(sudo -n cat "$profiles_file" 2>/dev/null)"; then
        profiles_read=true
    fi
fi
if [[ "$profiles_read" == true ]]; then
    profile_line="$(printf '%s\n' "$profiles_content" | grep -F "$profile_name " | head -n 1 || true)"
    if [[ -z "$profile_line" ]]; then
        echo "Crawl4AI AppArmor profile: NOT LOADED"
        status=2
    elif [[ "$profile_line" == *"(enforce)"* ]]; then
        echo "Crawl4AI AppArmor profile: loaded and enforced"
    else
        echo "Crawl4AI AppArmor profile: INCOMPLETE (not in enforce mode)"
        status=2
    fi
else
    echo "Crawl4AI AppArmor profile: INCOMPLETE (profile list is not readable; run with root or passwordless sudo access)"
    status=2
fi

if [[ -r "$restriction_file" ]]; then
    restriction="$(tr -d '\n' < "$restriction_file")"
    if [[ "$restriction" == "1" ]]; then
        echo "Unprivileged user-namespace restriction: enabled"
    else
        echo "Unprivileged user-namespace restriction: INCOMPLETE (expected 1, found $restriction)"
        status=2
    fi
else
    echo "Unprivileged user-namespace restriction: INCOMPLETE (kernel setting is unavailable)"
    status=2
fi

if command -v apparmor_parser >/dev/null 2>&1; then
    echo "AppArmor parser: available"
else
    echo "AppArmor parser: INCOMPLETE (apparmor_parser is unavailable)"
    status=2
fi

if [[ "$status" -eq 0 ]]; then
    echo "AppArmor host preflight: PASS"
else
    echo "AppArmor host preflight: INCOMPLETE"
fi
exit "$status"
