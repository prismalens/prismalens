const fs = require('fs');
const path = require('path');

const cliDir = path.join(__dirname, 'packages/cli/src/cli');
const files = fs.readdirSync(cliDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'flags.ts' && f !== 'grouping.ts');

const loopPattern = /\t\t\tfor \(const key of Object\.keys\(args\)\) \{\n\t\t\t\tif \(key !== "_" && !\(\(cmd\?\.args(?: as Record<string, unknown>)?\)\?\\.\[key\](?: \?\? cmd\?\.args\?\.\\\[key\\\])?(?: as any)?\)\) \{\n\t\t\t\t\tconsola\.error\(`Unknown option: --\$\{key\}`\);\n\t\t\t\t\tprocess\.exit\(1\);\n\t\t\t\t\}\n\t\t\t\}/g;

const exactPattern = /\t\t\tfor \(const key of Object\.keys\(args\)\) \{\n\t\t\t\tif \(key !== "_" && !\(cmd\?\.args as Record<string, unknown>\)\?\.\[key\]\) \{\n\t\t\t\t\tconsola\.error\(`Unknown option: --\$\{key\}`\);\n\t\t\t\t\tprocess\.exit\(1\);\n\t\t\t\t\}\n\t\t\t\}/g;

for (const file of files) {
  const filePath = path.join(cliDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  if (content.match(exactPattern)) {
    content = content.replace(exactPattern, '\t\t\tassertKnownFlags(args, cmd);');
    
    // Add import statement
    if (!content.includes('import { assertKnownFlags }')) {
      content = content.replace(/(import consola from "consola";)/, '$1\nimport { assertKnownFlags } from "./flags.js";');
    }
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed', file);
  } else {
    console.log('Pattern not found in', file);
  }
}
