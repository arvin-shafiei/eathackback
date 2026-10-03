import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
let server, insights, stats, rearrange;
before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  insights = await server.ssrLoadModule('/src/insights.ts');
  stats = await server.ssrLoadModule('/src/stats.ts');
  rearrange = await server.ssrLoadModule('/src/rearrange.ts');
});
after(async () => { await server?.close(); });
const event = (step, decision, extra = {}) => ({ step, product: 'x', slot: 'U1-r1', noticed: decision !== 'not_noticed', p_notice: 0.5, decision, reason: 'recorded reason', ...extra });
test('failed calls and unhandled rejections do not inflate pick-up or put-back counts', () => {
  const events = [event(0, 'pick', { picked_up: true }), event(1, 'reject', { picked_up: true }), event(2, 'reject', { picked_up: false }), event(3, 'not_noticed'), event(4, 'walk_past', { mechanism: 'error' })];
  const run = { run_id: 'test', agents: [{ agent_id: 'a', persona_id: 'p', events }, { agent_id: 'ai', persona_id: 'ai_agent', events: [event(0, 'pick')] }] };
  const f = insights.funnels(run, 'human').x;
  assert.deepEqual([f.shown, f.noticed, f.considered, f.picked, f.rejected, f.walk_past, f.shoppers], [4, 3, 2, 1, 1, 1, 1]);
  const p = stats.productStats(run, 'x', 'human', {});
  assert.equal(p.considered, f.considered); assert.equal(p.shown, f.shown);
  assert.equal(insights.funnels(run, 'ai').x.shown, 1);
  assert.equal(insights.rejections(run, 'x', 'human').total, 1);
  const b = insights.behaviour(run, 'x', {});
  assert.equal(b.rows.length, 4); assert.equal(b.rows[1].step, 1);
});
test('standard and superstore funnels match independent event counts for every product', async () => {
  for (const file of ['run_20261003_120823_s11_jev_4482', 'run_20261003_142844_s22_mock_483c']) {
  const run = JSON.parse(await readFile(`public/data/runs/${file}.json`, 'utf8'));
  const computed = insights.funnels(run, 'human');
  for (const [code, f] of Object.entries(computed)) {
    const es = run.agents.flatMap(a => a.events).filter(e => e.product === code && e.mechanism !== 'error');
    const handled = e => typeof e.picked_up === 'boolean' ? e.picked_up : e.stage_reached ? ['put_back', 'taken'].includes(e.stage_reached) : e.noticed && ['pick', 'reject'].includes(e.decision);
    assert.equal(f.shown, es.length, code);
    assert.equal(f.considered, es.filter(handled).length, code);
    assert.equal(f.picked, es.filter(e => e.decision === 'pick').length, code);
    assert.equal(f.rejected, es.filter(e => e.decision === 'reject' && handled(e)).length, code);
    assert.ok(f.shown >= f.noticed && f.noticed >= f.considered && f.considered >= f.picked, code);
  }
  }
});
test('a shelf loop preserves every product and its facings without mutating the current shelf', () => {
  const plan = { 'U1-r1': { category: 'test', products: ['a', 'b', 'c'], facings: { a: 1, b: 2, c: 3 } } };
  const spot = pos => ({ slot: 'U1-r1', pos });
  const moves = [{ code: 'a', from: spot(0), to: spot(1) }, { code: 'b', from: spot(1), to: spot(2) }, { code: 'c', from: spot(2), to: spot(0) }];
  const steps = rearrange.orderSteps(moves);
  assert.equal(steps.length, 3);
  const proposed = rearrange.applySteps(plan, steps);
  assert.deepEqual(proposed['U1-r1'].products, ['c', 'a', 'b']);
  assert.deepEqual(proposed['U1-r1'].facings, { a: 1, b: 2, c: 3 });
  assert.deepEqual(plan['U1-r1'].products, ['a', 'b', 'c']);
  const u = { unit: 'U1', lift_pct: 0.1, moves };
  assert.equal(rearrange.shelfSuggestions({ units: [u] }, { units: [u] })[0].steps.length, 3);
  assert.equal(rearrange.orderSteps([]), null);
});
test('a larger shelf change falls back to the same one-swap plan on both screens', () => {
  const spot = pos => ({ slot: 'U1-r1', pos });
  const pair = [{ code: 'a', from: spot(0), to: spot(1) }, { code: 'b', from: spot(1), to: spot(0) }];
  const twoPairs = [...pair, { code: 'c', from: spot(2), to: spot(3) }, { code: 'd', from: spot(3), to: spot(2) }];
  const simple = { unit: 'U1', lift_pct: 0.03, moves: pair };
  const larger = { ...simple, lift_pct: 0.06, moves: twoPairs };
  const selected = rearrange.shelfSuggestions({ units: [simple] }, { units: [larger] })[0];
  assert.equal(selected.u.lift_pct, 0.03); assert.equal(selected.steps.length, 2);
});
