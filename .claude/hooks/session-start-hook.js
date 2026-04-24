#!/usr/bin/env node

/**
 * Session Start Hook for Procedural Cities
 * Initializes development environment on session start
 */

const fs = require('fs');
const path = require('path');

try {
  // Verify project setup
  const requiredDirs = [
    'docs',
    'docs/js',
    '.claude',
    '.claude/hooks',
    '.claude/agents',
    '.claude/skills'
  ];

  const allExist = requiredDirs.every(dir => {
    return fs.existsSync(dir);
  });

  if (!allExist) {
    console.error('⚠️  Project structure incomplete. Some directories are missing.');
    process.exit(1);
  }

  // Check for critical files
  const criticalFiles = [
    'docs/index.html',
    'docs/js/main.js',
    '.claude/settings.json'
  ];

  const allFilesExist = criticalFiles.every(file => {
    return fs.existsSync(file);
  });

  if (!allFilesExist) {
    console.error('⚠️  Critical files missing. Project may be corrupted.');
    process.exit(1);
  }

  // Initialize session successfully
  console.log('✓ Session initialized - Procedural Cities environment ready');
  process.exit(0);

} catch (error) {
  console.error('❌ Session initialization failed:', error.message);
  process.exit(1);
}
