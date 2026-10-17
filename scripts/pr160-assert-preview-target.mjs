import process from 'node:process';
import { assertPr160PreviewTarget } from './pr160-test-environment.mjs';

try {
  assertPr160PreviewTarget(process.env);
  process.stdout.write(
    'PR160 Preview target configuration validated; live resources unverified.\n',
  );
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
