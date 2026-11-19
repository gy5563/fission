// Pure-logic tests for utils/tree.ts — run with `pnpm test` (Node >= 22.6,
// native TS type-stripping; no browser globals needed, storage is never touched).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DEPTH,
  sanitizeTopics,
  newTopic,
  newNode,
  locate,
  subtreeHeight,
  countNodes,
  progress,
  topicProgress,
  toggleDone,
  addTask,
  indentBlockReason,
  canIndent,
  indentTask,
  canOutdent,
  outdentTask,
  removeTask,
  toMarkdown,
  slugify,
} from '../utils/tree.ts';

const leaf = (text = '') => newNode(text);
/** Chain of n nested nodes, innermost last. Returns the root. */
function chain(n) {
  const root = leaf('L1');
  let cur = root;
  for (let i = 2; i <= n; i++) {
    const c = leaf('L' + i);
    cur.children.push(c);
    cur = c;
  }
  return root;
}
const maxDepthOf = (nodes, d = 1) =>
  nodes.reduce((m, n) => Math.max(m, n.children.length ? maxDepthOf(n.children, d + 1) : d), 0);

test('subtreeHeight: leaf, deep chain, and unbounded breadth', () => {
  assert.equal(subtreeHeight(leaf()), 1);
  assert.equal(subtreeHeight(chain(MAX_DEPTH)), MAX_DEPTH);
  // Regression: Math.max(...children.map()) overflowed the call stack here.
  const wide = leaf('parent');
  wide.children = Array.from({ length: 200_000 }, () => leaf());
  assert.equal(subtreeHeight(wide), 2);
});

test('sanitizeTopics: rejects garbage, fixes ids, clamps depth bombs', () => {
  assert.deepEqual(sanitizeTopics(null), []);
  assert.deepEqual(sanitizeTopics('nope'), []);
  const bomb = { id: 't', title: 'bomb', tasks: [] };
  let cur = bomb.tasks;
  for (let i = 0; i < MAX_DEPTH + 5; i++) {
    const n = { id: 'n' + i, text: 'x', done: false, children: [] };
    cur.push(n);
    cur = n.children;
  }
  const dup = { id: 't', title: 'dup', tasks: [{ id: 'same', text: 'a', children: [{ id: 'same', text: 'b', children: [] }] }] };
  const out = sanitizeTopics([bomb, dup, 42, null]);
  assert.equal(out.length, 2);
  assert.ok(maxDepthOf(out[0].tasks) <= MAX_DEPTH, 'depth clamped');
  const ids = [out[1].tasks[0].id, out[1].tasks[0].children[0].id];
  assert.notEqual(ids[0], ids[1], 'duplicate ids regenerated');
});

test('sanitizeTopics: timer validation', () => {
  const t = {
    id: 't', title: 'x', tasks: [
      { id: 'a', text: 'ok', timer: { minutes: 5, endsAt: Date.now() + 300000 }, children: [] },
      { id: 'b', text: 'bad', timer: { minutes: -1, endsAt: 0 }, children: [] },
      { id: 'c', text: 'bad2', timer: { minutes: 9999, endsAt: NaN }, children: [] },
    ],
  };
  const [topic] = sanitizeTopics([t]);
  assert.ok(topic.tasks[0].timer);
  assert.equal(topic.tasks[1].timer, undefined);
  assert.equal(topic.tasks[2].timer, undefined);
});

test('addTask enforces the depth cap', () => {
  const topic = newTopic('cap');
  topic.tasks.push(chain(MAX_DEPTH));
  // walk to the innermost node
  let cur = topic.tasks[0];
  while (cur.children.length) cur = cur.children[0];
  assert.equal(locate(topic.tasks, cur.id).depth, MAX_DEPTH);
  assert.equal(addTask(topic, cur.id, 'too deep'), null);
  assert.ok(addTask(topic, null, 'root ok'));
});

test('indent/outdent: sibling, height and depth guards', () => {
  const topic = newTopic('io');
  const a = addTask(topic, null, 'a');
  const b = addTask(topic, null, 'b');
  assert.equal(indentBlockReason(topic, a.id), 'sibling'); // first child can't indent
  assert.equal(canIndent(topic, b.id), true);
  assert.ok(indentTask(topic, b.id));
  assert.equal(a.children.length, 1);
  assert.equal(locate(topic.tasks, b.id).depth, 2);
  assert.ok(canOutdent(topic, b.id));
  assert.ok(outdentTask(topic, b.id));
  assert.equal(topic.tasks.length, 2);
  assert.equal(locate(topic.tasks, b.id).depth, 1);
  assert.equal(canOutdent(topic, b.id), false); // root can't outdent

  // height guard: indenting a tall subtree would exceed MAX_DEPTH
  const tall = newTopic('tall');
  addTask(tall, null, 'prev');
  const tallRoot = addTask(tall, null, 'tall');
  tallRoot.children.push(chain(MAX_DEPTH - 1)); // height MAX_DEPTH-1 below it
  assert.equal(indentBlockReason(tall, tallRoot.id), 'height');
});

test('toggleDone cascades down only', () => {
  const topic = newTopic('cascade');
  const p = addTask(topic, null, 'parent');
  const c = addTask(topic, p.id, 'child');
  addTask(topic, c.id, 'grandchild');
  toggleDone(topic, p.id);
  assert.ok(p.done && c.done && c.children[0].done);
  toggleDone(topic, c.id); // uncheck child subtree — parent keeps its flag
  assert.ok(p.done);
  assert.ok(!c.done && !c.children[0].done);
  assert.deepEqual(progress(p), { done: 0, total: 2 });
  assert.deepEqual(topicProgress(topic), { done: 1, total: 3 });
});

test('removeTask and countNodes', () => {
  const topic = newTopic('rm');
  const p = addTask(topic, null, 'p');
  addTask(topic, p.id, 'c');
  assert.equal(countNodes(topic.tasks), 2);
  assert.ok(removeTask(topic, p.id));
  assert.equal(countNodes(topic.tasks), 0);
  assert.equal(removeTask(topic, 'ghost'), false);
});

test('toMarkdown + slugify', () => {
  const topic = newTopic('我的清单');
  const p = addTask(topic, null, 'parent');
  addTask(topic, p.id, 'child');
  toggleDone(topic, p.id);
  const md = toMarkdown(topic);
  assert.ok(md.startsWith('# 我的清单\n'));
  assert.ok(md.includes('- [x] parent'));
  assert.ok(md.includes('  - [x] child'));
  assert.ok(md.includes('2/2 done'));
  assert.equal(slugify('我的清单'), 'topic'); // non-Latin falls back
  assert.equal(slugify('Hello, World!'), 'hello-world');
});
