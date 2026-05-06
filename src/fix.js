import { readFileSync, writeFileSync } from 'fs';
let f = readFileSync('src/promptEngine.js', 'utf8');
f = f.replace(
  'return JSON.parse(response.content[0].text);',
  'const raw = response.content[0].text.replace(/```json\\n?|```\\n?/g, "").trim();\n    return JSON.parse(raw);'
);
writeFileSync('src/promptEngine.js', f);
console.log('Fixed!');
