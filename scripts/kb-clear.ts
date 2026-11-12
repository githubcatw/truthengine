// Deletes knowledge-base vectors.
//
//   npm run kb:clear -- --yes                        public passages only (kbPublic + kbSources)
//   npm run kb:clear -- --yes --include-classroom    also every teacher material (kbClassroom + classroomMaterials)
//
// Without --yes it only prints what it would delete. Nothing else is touched.
import { db } from '../src/server/firebase';
import { C, col } from '../src/server/pipeline/store';

const yes = process.argv.includes('--yes');
const includeClassroom = process.argv.includes('--include-classroom');
const targets = [C.kbPublic, C.kbSources, ...(includeClassroom ? [C.kbClassroom, C.materials] : [])];

for (const name of targets) {
  const count = (await col(name).count().get()).data().count;
  console.log(`${name}: ${count} document(s)${yes ? ' — deleting' : ''}`);
  if (yes && count) await db().recursiveDelete(col(name));
}
if (!yes) console.log('Dry run. Add --yes to delete.');
