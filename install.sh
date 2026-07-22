#!/bin/sh
set -eu

# EXTELLA_STANDALONE_INSTALLER_RETIRED=1
#
# This repository is a build input, not a user-facing distribution channel.
# Deploying one generated file from a mutable checkout bypasses the signed,
# atomic Extella Client transaction and can leave the toolbar, Catalog data,
# Activity Center, and account state at incompatible revisions.

printf '%s\n' >&2 \
  '{"status":"failed","errorClass":"StandaloneInstallerRetired","message":"Direct toolbar installation is retired. Install a signed Extella Client release through its versioned bootstrap with the published SHA-256 and byte size. Supported targets: macOS Intel, macOS Apple Silicon, and Windows 11 x64. A raw source checkout is not an installable release."}'
exit 2
