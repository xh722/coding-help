'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const script = fs.readFileSync(path.join(__dirname, '..', 'tools', 'windows-dynamic-preflight.ps1'), 'utf8');

test('Windows preflight never launches the supplied sample', () => {
  assert.match(script, /Get-FileHash/);
  assert.match(script, /ExpectedSha256/);
  assert.match(script, /does not match the expected authorized fixture/);
  assert.match(script, /executionStarted\s*=\s*\$false/);
  assert.doesNotMatch(script, /Start-Process/i);
  assert.doesNotMatch(script, /Invoke-Expression/i);
  assert.doesNotMatch(script, /&\s*\$SamplePath/);
  assert.doesNotMatch(script, /\.\s*\$SamplePath/);
});

test('Windows preflight collects an OS/process/environment baseline', () => {
  assert.match(script, /Win32_OperatingSystem/);
  assert.match(script, /Get-Process/);
  assert.match(script, /Get-ChildItem Env:/);
  assert.match(script, /Get-ScheduledTask/);
  assert.match(script, /sample-manifest\.json/);
});
