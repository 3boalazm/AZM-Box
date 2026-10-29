import { preserveSheetRegistration } from "../src/artwork/rootAnchoring";

const cases = [
  { name: "bottom expansion", offset: { x: 0, y: 0 }, before: { x: 5, y: 105 }, after: { x: 5, y: 144 } },
  { name: "left expansion", offset: { x: 0, y: 8 }, before: { x: 35, y: 105 }, after: { x: 55, y: 105 } },
  { name: "unchanged template", offset: { x: 4, y: 9 }, before: { x: 5, y: 105 }, after: { x: 5, y: 105 } },
];
let failures = 0;
for (const test of cases) {
  const adjusted = preserveSheetRegistration(test.offset, test.before, test.after);
  const relativeBefore = { x: test.offset.x - test.before.x, y: test.offset.y - test.before.y };
  const relativeAfter = { x: adjusted.x - test.after.x, y: adjusted.y - test.after.y };
  const ok = Math.abs(relativeBefore.x - relativeAfter.x) < 1e-9 && Math.abs(relativeBefore.y - relativeAfter.y) < 1e-9;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} artwork/root registration is stable after ${test.name}`);
}
console.log(failures === 0 ? "\nALL ARTWORK ANCHOR CHECKS PASSED" : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
