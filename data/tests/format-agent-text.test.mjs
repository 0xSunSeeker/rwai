// Regression test: formatAgentText() converts the markdown emphasis the agent
// emits (**bold**, *italic*) into HTML, with HTML-escaping applied BEFORE the
// emphasis substitution so LLM text never reaches innerHTML unescaped.
//
// The test extracts the helper directly from dashboard.html (no duplication)
// and exercises it against the spec's cases.
//
// Run: node data/tests/format-agent-text.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

const html = readFileSync('dashboard.html', 'utf8');

// Extract `function formatAgentText(...) { ... }` from inline JS.
// Matches up to the first `  }` at the standard 2-space outer indent.
const match = html.match(/function\s+formatAgentText\s*\(([\s\S]*?)\n  \}/);
if (!match) {
  console.log('❌ FAIL — formatAgentText not found in dashboard.html');
  process.exit(1);
}
const fnSrc = 'function formatAgentText(' + match[1] + '\n  }';
let formatAgentText;
try {
  formatAgentText = eval('(' + fnSrc + ')');
} catch (e) {
  console.log('❌ FAIL — could not eval extracted helper:', e.message);
  console.log('--- extracted source ---');
  console.log(fnSrc);
  process.exit(1);
}

console.log('REGRESSION: formatAgentText escapes HTML first, then converts **bold**/​*italic*');
console.log();

const cases = [
  // [label, input, expected]
  ['bold', '**bold** word', '<strong>bold</strong> word'],
  ['italic', '*still* here', '<em>still</em> here'],
  ['mixed', '**a** and *b*', '<strong>a</strong> and <em>b</em>'],
  ['HTML injection escaped, bold applied', '<img src=x onerror=alert(1)> **x**', '&lt;img src=x onerror=alert(1)&gt; <strong>x</strong>'],
  ['lone asterisk stays literal', 'cost *only', 'cost *only'],
];

const failures = [];
for (const [label, input, expected] of cases) {
  const actual = formatAgentText(input);
  if (actual === expected) {
    console.log('  ✓ ' + label);
  } else {
    console.log('  ✗ ' + label);
    console.log('      input    : ' + JSON.stringify(input));
    console.log('      expected : ' + JSON.stringify(expected));
    console.log('      actual   : ' + JSON.stringify(actual));
    failures.push(label);
  }
}

console.log();
if (failures.length === 0) {
  console.log('✅ PASS — formatAgentText escapes-then-formats correctly');
  process.exit(0);
} else {
  console.log('❌ FAIL (' + failures.length + ' case' + (failures.length === 1 ? '' : 's') + '): ' + failures.join(' | '));
  process.exit(1);
}
