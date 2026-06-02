// Monorepo + pnpm-aware Metro config. pnpm stores packages in a flat
// .pnpm/ directory and uses symlinks to expose them; Metro needs symlink
// resolution enabled to follow those when looking up transitive deps.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

// Normalize to the OS-canonical path casing. On Windows the drive can be
// referenced as either `D:\workspaces` or `D:\Workspaces`; Node/Expo resolve
// module paths via fs.realpathSync.native (which returns the canonical casing,
// e.g. capital "Workspaces"), while metro.config.js's __dirname reflects the
// casing the shell happened to cd in with. If those differ, Metro's
// case-sensitive haste map indexes files under one casing but looks them up
// under the other and throws "Failed to get the SHA-1 for ...". Resolving both
// roots through realpathSync.native keeps the casing consistent regardless of
// how the directory was entered.
const projectRoot = fs.realpathSync.native(__dirname);
const workspaceRoot = fs.realpathSync.native(path.resolve(projectRoot, '../..'));

const config = getDefaultConfig(projectRoot);

// Watch the entire workspace so changes in other packages trigger reloads.
config.watchFolders = [workspaceRoot];

// Look for modules in both this app's node_modules and the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Follow pnpm's symlinks into .pnpm/ so transitive deps resolve correctly.
config.resolver.unstable_enableSymlinks = true;

// Allow Metro to walk up the directory tree to find node_modules — required
// when transitive deps live deep inside .pnpm/<pkg>/node_modules/.
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
