#!/usr/bin/env bash
# One-time root installer for the constrained Lumi release capability.
#
# Run only after independently checking this installer's SHA-256. The staged
# payload is hash-pinned below, so a later change to a user-writable staged file
# cannot be installed as root.

set -Eeuo pipefail
IFS=$'\n\t'
umask 077

readonly WRAPPER_SHA256='7232c10c17f58c9f1e5fc371fe07105262cc94a09900c7fba386398a9ad97049'
readonly SUDOERS_SHA256='28b46dcfba3e4609ff747ed2df375cd90234eb011a5af9070be4361d2fa05846'
readonly SIGNERS_SHA256='00c197eced4f7607f55243db8cf718c8e2e02574cca12352c64076fdecd5b721'

readonly WRAPPER_TARGET='/usr/local/sbin/lumi-release'
readonly SUDOERS_TARGET='/etc/sudoers.d/90-lumi-release-arlo'
readonly SIGNERS_TARGET='/etc/lumi/lumi-release-allowed-signers'
readonly INPUT_ROOT='/home/arlo/lumi-release-input'
readonly WORK_ROOT='/var/lib/lumi/release-operations'
readonly SEAL_ROOT='/var/lib/lumi/release-operations/prepared'
readonly EVIDENCE_ROOT='/home/arlo/lumi-deploy-attempts/deploy-attempts'

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

assert_sha256() {
  local path=$1
  local expected=$2
  local actual
  [[ -f "$path" && ! -L "$path" ]] || die "STAGED_FILE_UNSAFE:$path"
  actual=$(sha256sum -- "$path" | awk '{print $1}')
  [[ "$actual" == "$expected" ]] || die "STAGED_FILE_SHA256_MISMATCH:$path"
}

ensure_directory() {
  local path=$1
  local owner=$2
  local group=$3
  local mode=$4
  if [[ ! -e "$path" && ! -L "$path" ]]; then
    install -d -o "$owner" -g "$group" -m "$mode" "$path"
  fi
  [[ -d "$path" && ! -L "$path" ]] || die "DIRECTORY_UNSAFE:$path"
  [[ "$(stat -c '%U:%G:%a' -- "$path")" == "$owner:$group:$mode" ]] || die "DIRECTORY_MODE_UNEXPECTED:$path"
}

backup_if_present() {
  local source=$1
  local backup=$2
  if [[ -e "$source" || -L "$source" ]]; then
    [[ -f "$source" && ! -L "$source" ]] || die "EXISTING_TARGET_UNSAFE:$source"
    install -o root -g root -m 0700 "$source" "$backup"
    printf '%s\n' "$backup"
  else
    printf '%s\n' 'NONE'
  fi
}

[[ "$EUID" -eq 0 ]] || die 'RUN_WITH_SUDO_ONCE'
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly STAGED_WRAPPER="$SCRIPT_DIR/lumi-release"
readonly STAGED_SUDOERS="$SCRIPT_DIR/lumi-release.sudoers"
readonly STAGED_SIGNERS="$SCRIPT_DIR/lumi-release-allowed-signers"

assert_sha256 "$STAGED_WRAPPER" "$WRAPPER_SHA256"
assert_sha256 "$STAGED_SUDOERS" "$SUDOERS_SHA256"
assert_sha256 "$STAGED_SIGNERS" "$SIGNERS_SHA256"
bash -n "$STAGED_WRAPPER"
visudo -cf "$STAGED_SUDOERS"

[[ -d /usr/local/sbin && ! -L /usr/local/sbin ]]
[[ -d /etc/lumi && ! -L /etc/lumi ]]
[[ -d /etc/sudoers.d && ! -L /etc/sudoers.d ]]
ensure_directory "$INPUT_ROOT" arlo arlo 700
ensure_directory "$WORK_ROOT" root root 700
ensure_directory "$SEAL_ROOT" root root 700
[[ -d "$EVIDENCE_ROOT" && ! -L "$EVIDENCE_ROOT" ]] || die 'EVIDENCE_ROOT_UNSAFE'

readonly STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
readonly BACKUP_DIR="/root/lumi-release-wrapper-backups/$STAMP"
install -d -o root -g root -m 0700 "$BACKUP_DIR"
WRAPPER_BACKUP=$(backup_if_present "$WRAPPER_TARGET" "$BACKUP_DIR/lumi-release")
SUDOERS_BACKUP=$(backup_if_present "$SUDOERS_TARGET" "$BACKUP_DIR/90-lumi-release-arlo")
SIGNERS_BACKUP=$(backup_if_present "$SIGNERS_TARGET" "$BACKUP_DIR/lumi-release-allowed-signers")

readonly WRAPPER_TMP="/usr/local/sbin/.lumi-release.$$.new"
readonly SUDOERS_TMP="/etc/sudoers.d/.90-lumi-release-arlo.$$.new"
readonly SIGNERS_TMP="/etc/lumi/.lumi-release-allowed-signers.$$.new"

install -o root -g root -m 0750 "$STAGED_WRAPPER" "$WRAPPER_TMP"
bash -n "$WRAPPER_TMP"
install -o root -g root -m 0644 "$STAGED_SIGNERS" "$SIGNERS_TMP"
install -o root -g root -m 0440 "$STAGED_SUDOERS" "$SUDOERS_TMP"
visudo -cf "$SUDOERS_TMP"

mv -f -- "$WRAPPER_TMP" "$WRAPPER_TARGET"
mv -f -- "$SIGNERS_TMP" "$SIGNERS_TARGET"
mv -f -- "$SUDOERS_TMP" "$SUDOERS_TARGET"

[[ "$(stat -c '%U:%G:%a' -- "$WRAPPER_TARGET")" == 'root:root:750' ]]
[[ "$(stat -c '%U:%G:%a' -- "$SIGNERS_TARGET")" == 'root:root:644' ]]
[[ "$(stat -c '%U:%G:%a' -- "$SUDOERS_TARGET")" == 'root:root:440' ]]
visudo -cf "$SUDOERS_TARGET"

printf 'INSTALL=SUCCEEDED\n'
printf 'WRAPPER=%s\n' "$WRAPPER_TARGET"
printf 'WRAPPER_SHA256=%s\n' "$WRAPPER_SHA256"
printf 'SUDOERS=%s\n' "$SUDOERS_TARGET"
printf 'ALLOWED_SIGNERS=%s\n' "$SIGNERS_TARGET"
printf 'INPUT_ROOT=%s\n' "$INPUT_ROOT"
printf 'BACKUP_DIR=%s\n' "$BACKUP_DIR"
printf 'BACKUP_WRAPPER=%s\n' "$WRAPPER_BACKUP"
printf 'BACKUP_SUDOERS=%s\n' "$SUDOERS_BACKUP"
printf 'BACKUP_SIGNERS=%s\n' "$SIGNERS_BACKUP"
printf 'NEXT=sudo -n /usr/local/sbin/lumi-release status\n'
