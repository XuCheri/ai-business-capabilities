import test from 'node:test';
import assert from 'node:assert/strict';
import { auditAnswer, exportAudit, EvidenceInputError } from '../dist/index.js';
const document = '说明📘：服务时段为09:00至18:00。企业套餐每年包含4次上门巡检。';
const quote = '企业套餐每年包含4次上门巡检。';
const request = (overrides = {}) => ({ answerId: 'answer-001', tenantId: 't1', at: 1000,
  allowedSourceIds: ['handbook'], sources: [{ id: 'handbook', tenantId: 't1', title: '虚构服务手册', currentVersionId: 'v2',
    versions: [{ id: 'v2', text: document, validFrom: 100, validUntil: 2000 }] }],
  claims: [{ id: 'c1', text: quote, requiresCitation: true, citations: [{ sourceId: 'handbook', versionId: 'v2', quote }] }], ...overrides });
const codes = r => r.claims.flatMap(c => [...c.findings, ...c.citations.flatMap(c => c.findings)]).map(f => f.code);

test('完整授权、有效版本、唯一原文引文通过结构校验', () => {
  const report = auditAnswer(request()); assert.equal(report.decision, 'pass');
  assert.equal(report.summary.coveredRequiredClaims, 1); assert.equal(report.claims[0].citations[0].anchor.start, document.indexOf(quote));
  assert.equal(report.policy.semanticEntailmentChecked, false);
});
test('指定UTF-16范围可精确定位，emoji占两个code unit', () => {
  const r = request(); const start = document.indexOf(quote); r.claims[0].citations[0].anchor = { start, end: start + quote.length };
  const report = auditAnswer(r); assert.equal(report.decision, 'pass');
  assert.equal(report.claims[0].citations[0].anchor.offsetUnit, 'utf16-code-unit');
  assert.equal(document.indexOf('：'), 4);
});
test('代理对内部锚点被阻断，不把半个emoji当可引用内容', () => {
  const r = request(); r.claims[0].citations[0] = { sourceId: 'handbook', versionId: 'v2', quote: '\ud83d', anchor: { start: 2, end: 3 } };
  assert.ok(codes(auditAnswer(r)).includes('ANCHOR_INVALID'));
});
test('自动查找也拒绝代理对片段', () => {
  const r = request(); r.claims[0].citations[0].quote = '\ud83d';
  assert.ok(codes(auditAnswer(r)).includes('ANCHOR_INVALID'));
});
test('越界、逆序、负值和NaN锚点均被阻断', () => {
  for (const anchor of [{ start: -1, end: 4 }, { start: 2, end: 1 }, { start: 0, end: 9999 }, { start: NaN, end: 4 }]) {
    const r = request(); r.claims[0].citations[0].anchor = anchor; assert.ok(codes(auditAnswer(r)).includes('ANCHOR_INVALID'));
  }
});
test('范围内的原文必须严格等于quote', () => {
  const r = request(); r.claims[0].citations[0].anchor = { start: 0, end: quote.length };
  assert.ok(codes(auditAnswer(r)).includes('ANCHOR_MISMATCH'));
});
test('伪造引文即使数字相同也阻断', () => {
  const r = request(); r.claims[0].citations[0].quote = '企业套餐每月包含4次上门巡检。';
  assert.ok(codes(auditAnswer(r)).includes('QUOTE_NOT_FOUND')); assert.equal(auditAnswer(r).decision, 'block');
});
test('重复原文不猜锚点；明确范围后通过', () => {
  const r = request(); r.sources[0].versions[0].text = `${quote}\n${quote}`;
  let report = auditAnswer(r); assert.equal(report.decision, 'review'); assert.equal(report.claims[0].covered, false);
  assert.equal(report.claims[0].citations[0].anchor, undefined); assert.ok(codes(report).includes('QUOTE_AMBIGUOUS'));
  r.claims[0].citations[0].anchor = { start: 0, end: quote.length }; report = auditAnswer(r); assert.equal(report.decision, 'pass');
});
test('Unicode规范等价但字节字符串不同，不隐式归一化', () => {
  const r = request(); r.sources[0].versions[0].text = 'Café'; r.claims[0].citations[0].quote = 'Cafe\u0301';
  assert.ok(codes(auditAnswer(r)).includes('QUOTE_NOT_FOUND'));
});
test('缺失来源和不允许访问的来源输出完全相同且不泄漏', () => {
  const r = request(); r.allowedSourceIds = []; r.sources[0].title = 'SECRET_TITLE'; r.sources[0].versions[0].text = 'SECRET_BODY';
  const hidden = auditAnswer(r); r.sources = []; const absent = auditAnswer(r);
  assert.deepEqual(hidden, absent); const json = exportAudit(hidden);
  for (const secret of ['SECRET_TITLE', 'SECRET_BODY', 'handbook', 'v2', quote]) {
    // claim.text是调用方自带文本，先移除它，检查引文结果和其余报告不回显来源。
    const sanitized = structuredClone(hidden); sanitized.claims[0].text = 'caller text';
    assert.equal(exportAudit(sanitized).includes(secret), false, secret);
  }
  assert.equal(json.includes('SOURCE_UNAVAILABLE'), true); assert.equal(hidden.claims[0].citations[0].source, undefined);
});
test('允许列表不能跨租户读取，跨租户同ID也不会遮盖本租户', () => {
  const r = request(); r.sources.unshift({ id: 'handbook', tenantId: 't2', title: 'SECRET', versions: [{ id: 'v2', text: 'SECRET' }] });
  assert.equal(auditAnswer(r).decision, 'pass'); r.sources = [r.sources[0]];
  const report = auditAnswer(r); assert.equal(report.decision, 'block'); assert.equal(exportAudit(report).includes('SECRET'), false);
});
test('授权来源不存在指定版本，版本查找不回退到最新', () => {
  const r = request(); r.claims[0].citations[0].versionId = 'v99';
  const report = auditAnswer(r); assert.ok(codes(report).includes('VERSION_NOT_FOUND'));
  assert.equal(report.claims[0].citations[0].document, undefined);
});
test('有效期start包含，end排他，尚未生效阻断、过期需复核', () => {
  assert.equal(auditAnswer(request({ at: 100 })).decision, 'pass');
  assert.ok(codes(auditAnswer(request({ at: 99 }))).includes('VERSION_NOT_YET_VALID'));
  assert.equal(auditAnswer(request({ at: 1999 })).decision, 'pass');
  assert.equal(auditAnswer(request({ at: 2000 })).decision, 'review');
});
test('文档撤回/版本撤回在时间边界阻断', () => {
  const r = request(); r.sources[0].withdrawnAt = 1000;
  assert.ok(codes(auditAnswer(r)).includes('DOCUMENT_WITHDRAWN'));
  delete r.sources[0].withdrawnAt; r.sources[0].versions[0].withdrawnAt = 1000;
  assert.ok(codes(auditAnswer(r)).includes('VERSION_WITHDRAWN'));
  assert.equal(auditAnswer({ ...r, at: 999 }).decision, 'pass');
});
test('必引声明缺失引用阻断，显式非必引声明可以不引', () => {
  const r = request(); r.claims[0].citations = []; assert.equal(auditAnswer(r).decision, 'block');
  r.claims[0].requiresCitation = false; assert.equal(auditAnswer(r).decision, 'pass');
  assert.equal(auditAnswer(r).summary.requiredClaims, 0);
});
test('数字缺失提示复核，数字相同不代表语义支持', () => {
  const r = request(); r.claims[0].text = '企业套餐每年包含8次上门巡检。';
  let report = auditAnswer(r); assert.equal(report.decision, 'review'); assert.deepEqual(report.claims[0].numericCheck.missingTokens, ['8']);
  r.claims[0].text = '企业套餐不包含4次上门巡检。'; report = auditAnswer(r);
  assert.equal(report.decision, 'pass'); assert.equal(report.policy.semanticEntailmentChecked, false);
});
test('数字粗检可关闭，不能读取不可访问/不匹配引用来做数字支持', () => {
  const r = request(); r.claims[0].text = '8次巡检'; assert.equal(auditAnswer({ ...r, checkNumbers: false }).decision, 'pass');
  r.allowedSourceIds = []; const report = auditAnswer(r); assert.equal(report.claims[0].numericCheck.performed, false);
  assert.deepEqual(report.claims[0].numericCheck.missingTokens, []);
});
test('同一回答多版本引用与旧版引用要求复核', () => {
  const r = request(); r.sources[0].versions.push({ id: 'v1', text: '旧套餐包含2次巡检。' });
  r.claims.push({ id: 'c2', text: '旧套餐包含2次巡检。', requiresCitation: true,
    citations: [{ sourceId: 'handbook', versionId: 'v1', quote: '旧套餐包含2次巡检。' }] });
  const report = auditAnswer(r); assert.ok(codes(report).includes('MIXED_VERSIONS')); assert.ok(codes(report).includes('VERSION_SUPERSEDED'));
  assert.equal(report.versionConflicts.length, 1); assert.equal(report.decision, 'review');
});
test('来源标题与非正文内容不得充当quote证据', () => {
  const r = request(); r.claims[0].citations[0].quote = '虚构服务手册'; assert.ok(codes(auditAnswer(r)).includes('QUOTE_NOT_FOUND'));
});
test('重复注册身份、重复claim ID、空引文、空回答和非法时间明确拒绝', () => {
  const r = request(); r.sources.push(structuredClone(r.sources[0])); assert.throws(() => auditAnswer(r), EvidenceInputError);
  const a = request(); a.claims.push(structuredClone(a.claims[0])); assert.throws(() => auditAnswer(a), /不可重复/);
  const b = request(); b.claims[0].citations[0].quote = ''; assert.throws(() => auditAnswer(b), /非空/);
  assert.throws(() => auditAnswer(request({ claims: [] })), /至少包含/);
  assert.throws(() => auditAnswer(request({ at: Infinity })), /时间戳/);
});
test('审计输出可JSON往返，调用不改输入；输出修改不改源', () => {
  const r = request(); const before = JSON.stringify(r); const report = auditAnswer(r);
  assert.equal(JSON.stringify(r), before); assert.deepEqual(JSON.parse(exportAudit(report)), report);
  report.claims[0].citations[0].document = 'changed'; assert.equal(r.sources[0].versions[0].text, document);
});
