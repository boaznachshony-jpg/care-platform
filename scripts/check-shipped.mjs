/* global console */
/**
 * "Is it actually shipped?" - lists local branches whose work has NOT reached
 * origin/main, so nothing can be reported as fixed while it is still sitting
 * unmerged. Pushing a branch only publishes the branch; production follows
 * origin/main, and three finished fixes once waited days because of that gap.
 *
 * Run: node scripts/check-shipped.mjs   (or `pnpm shipped`)
 *
 * Exit code is always 0 - this is a status report, not a gate.
 */
import { execSync } from 'node:child_process';

function git(command) {
  return execSync(`git ${command}`, { encoding: 'utf8' }).trim();
}

try {
  git('fetch origin --quiet');
} catch {
  console.warn('⚠️  Could not reach origin - showing the last known state.\n');
}

const branches = git('for-each-ref --format="%(refname:short)" refs/heads')
  .split('\n')
  .map((line) => line.replace(/^"|"$/g, ''))
  .filter((name) => name && name !== 'main');

const unmerged = [];
for (const branch of branches) {
  const ahead = Number(git(`rev-list --count origin/main..${branch}`));
  if (ahead > 0) {
    const subject = git(`log ${branch} -1 --pretty=%s`);
    let pushed = false;
    try {
      pushed = git(`rev-parse --verify --quiet origin/${branch}`) !== '';
    } catch {
      pushed = false;
    }
    unmerged.push({ branch, ahead, subject, pushed });
  }
}

console.log(`main in production: ${git('log origin/main -1 --pretty="%h %s"')}\n`);

if (unmerged.length === 0) {
  console.log('✅ Everything local is merged into origin/main. Nothing is waiting.');
} else {
  console.log(`⚠️  ${unmerged.length} branch(es) NOT in production yet:\n`);
  for (const item of unmerged) {
    console.log(
      `  ${item.branch}  (+${item.ahead} commit(s), ${item.pushed ? 'pushed' : 'NOT pushed'})`,
    );
    console.log(`     ${item.subject}`);
    console.log(
      `     PR: https://github.com/boaznachshony-jpg/care-platform/compare/main...${item.branch}?quick_pull=1\n`,
    );
  }
  console.log('Open each PR, wait for green CI, then Merge - see PENDING-MERGES.md.');
}
