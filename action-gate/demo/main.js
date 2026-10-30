import { ActionGate, GateError, canonicalize } from '../dist/index.js';
import { tools, policy, scenarios, subject, reviewers } from './config.js';

const initialTime = Date.parse('2026-10-30T09:30:00+08:00');
let now = initialTime, counter = 0, selected = 'mail', currentId = null, preflightSnapshot = null;
const createGate = () => new ActionGate({ tools, policy, now: () => now, idFactory: () => `AG-${String(++counter).padStart(4, '0')}` });
let gate = createGate();
const states = { allow: '可直接消费', deny: '已阻止', 'approval-required': '等待人工审批', approved: '审批已通过', rejected: '审批已拒绝', consumed: '许可已消费', expired: '许可已失效' };
const risks = { read: '读取', write: '写入', external: '外发', destructive: '破坏性' };
const reasonLabels = { UNKNOWN_TOOL: '工具未进入受控目录', INVALID_JSON: '参数不是受支持的严格 JSON', INVALID_ARGUMENTS: '参数不符合工具字段约定', REQUESTER_ROLE_DENIED: '当前角色没有申请权限', ARGUMENT_TENANT_MISMATCH: '参数中的租户与当前主体不一致', POLICY_DENIED: '命中拒绝规则', APPROVAL_NEEDED: '此操作需要另一位审批人确认', READ_ALLOWED: '受控读取可消费一次许可', HUMAN_APPROVED: '人工审批通过，等待消费', HUMAN_REJECTED: '审批人拒绝了本次申请', PERMIT_CONSUMED: '许可已经一次性消费', EXPIRED: '许可有效期已结束', POLICY_CHANGED: '策略更新使原许可失效' };
const formatTime = value => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(value);
const $ = selector => document.querySelector(selector);
const node = (tag, cls = '', text = '') => { const element = document.createElement(tag); element.className = cls; element.textContent = text; return element; };
$('#app').innerHTML = `
<header class="page-top"><a class="brand" href="#"><span class="brand-mark" aria-hidden="true">▤</span><div><strong>行动审批台</strong><small>AI 工具调用风险预检与审批门控</small></div></a><div class="top-meta"><span class="local-indicator"></span>本地模拟环境<span class="policy-pill">harbor-policy-v1</span></div></header>
<main><section class="intro"><div><h1>模型提出行动，<br>许可决定执行。</h1><p>先检查工具、参数与业务权限，再让人工确认高影响操作。<br>审批只覆盖眼前这次调用，改参、过期或重复消费都需要重新申请。</p></div><div class="boundary-note"><strong>演示不会执行真实工具</strong><p>全部身份与业务数据为虚构样例。此页面只展示预检、审批和一次性许可消费，不发送邮件，不修改设备。</p></div></section>
<section class="control-bar"><div><span class="clock-label">固定演示时钟</span><strong id="clock"></strong><span class="timezone">UTC+08:00</span></div><div class="clock-controls"><button id="advance">快进 11 分钟</button><button id="replace-policy">更新策略版本</button><button id="reset">重置演示</button></div></section>
<section class="workbench"><nav class="tool-rail" aria-label="调用场景"><h2>选择一个行动</h2><div id="scenarios"></div><div class="rail-bottom"><span class="rail-line"></span><p>风险取自维护者配置的工具目录。<br>模型不能给自己降低风险。</p><strong>拒绝优先于审批，审批优先于放行。</strong></div></nav>
<section class="draft-panel"><div class="section-head"><div><span class="step">1</span><h2>调用草稿</h2></div><span id="tool-risk" class="risk-chip"></span></div><label class="field-label" for="tool-id">工具标识</label><input id="tool-id" spellcheck="false" aria-label="工具标识"><div class="identity-strip"><div><span>申请主体</span><strong>operator-lin</strong></div><div><span>可信租户</span><strong>tenant-harbor</strong></div><div><span>请求角色</span><strong>operator</strong></div></div><div class="editor-head"><label class="field-label" for="arguments">调用参数 JSON</label><button id="mutate" class="text-button">修改参数试试</button></div><textarea id="arguments" spellcheck="false" aria-label="调用参数 JSON"></textarea><div class="draft-actions"><button id="preflight" class="primary">运行风险预检</button><button id="big-batch" class="subtle">载入 32 条批量变更</button></div><div id="feedback" class="feedback neutral" role="status" aria-live="polite">已载入外发示例。点击「运行风险预检」开始。</div><details class="policy-details"><summary>查看当前业务规则</summary><ul><li>外发只允许 service@partner.example.test，且始终需要审批。</li><li>批量变更超过 20 个设备，或将设备设为 disabled，直接拒绝。</li><li>审批人必须同租户、具备 approver 角色，且不是申请人。</li><li>许可自预检起 10 分钟有效；批准不会延长有效期。</li></ul></details></section>
<aside class="permit-panel"><div class="section-head"><div><span class="step">2</span><h2>审批与许可</h2></div><span class="once-chip">仅限一次</span></div><div class="ticket" id="ticket"></div><div class="reviewer-control"><label class="field-label" for="reviewer">模拟切换审批人</label><select id="reviewer"><option value="normal">周审阅 · 同租户审批人</option><option value="self">林申请 · 尝试自批</option><option value="foreign">陈审阅 · 其他租户</option><option value="viewer">吴查看 · 没有审批角色</option></select><div class="review-buttons"><button id="approve">批准此次调用</button><button id="reject">拒绝此次调用</button></div></div><div class="execution"><div><span class="step">3</span><h3>消费许可，模拟执行</h3></div><label class="sr-only" for="execution-subject">消费时的主体权限</label><select id="execution-subject"><option value="normal">当前申请人 · operator 权限正常</option><option value="revoked">当前申请人 · operator 权限已撤销</option><option value="foreign">当前申请人 · 改为其他租户</option></select><button id="consume" class="consume-button">消费一次执行许可</button><p>会重新检查草稿参数与当前权限。这里不会调用任何下游服务。</p></div></aside></section>
<section class="audit-section"><div class="audit-title"><div><h2>预检、审批与许可消费，留下可追溯记录。</h2><p>日志只保存主体标识、状态和原因码；不写入邮件正文、原始参数或任意审批备注。</p></div><button id="export">导出脱敏审计 JSON</button></div><div class="audit-table-wrap"><table><thead><tr><th>顺序 / 时间</th><th>请求</th><th>操作人</th><th>发生了什么</th><th>原因码</th></tr></thead><tbody id="audit-body"></tbody></table></div></section>
<footer><span>Action Gate · 可嵌入的业务门控参考实现</span><span>单实例内存状态，不是生产安全网关</span></footer></main>`;

function feedback(message, kind = 'neutral') { const target = $('#feedback'); target.textContent = message; target.className = `feedback ${kind}`; }
function currentCall() { return { toolId: $('#tool-id').value, args: JSON.parse($('#arguments').value) }; }
function run(operation, success) { try { const result = operation(); feedback(typeof success === 'function' ? success(result) : success, 'success'); render(); } catch (error) { feedback(`${error.code ? error.code + '：' : ''}${error.message}`, 'error'); render(); } }
function setScenario(id) {
  selected = id; currentId = null; preflightSnapshot = null;
  const scenario = scenarios.find(item => item.id === id);
  $('#tool-id').value = scenario.toolId; $('#arguments').value = JSON.stringify(scenario.args, null, 2);
  feedback('草稿已载入。运行预检后，才能审批或消费许可。'); render();
}
function renderTicket() {
  const container = $('#ticket'); container.replaceChildren();
  if (!currentId) { container.className = 'ticket empty-ticket'; container.append(node('div', 'empty-ticket-icon', '◇'), node('strong', '', '尚未生成许可'), node('p', '', '完成预检后，会在这里列出决策、绑定信息与有效期。')); return; }
  const record = gate.inspect(currentId); container.className = `ticket ${record.state}`;
  const top = node('div', 'ticket-top'); top.append(node('span', 'ticket-number', record.id), node('span', 'ticket-risk', record.risk ? risks[record.risk] : '未注册'));
  const status = node('strong', 'ticket-status', states[record.state]);
  const reason = node('p', 'ticket-reason', record.reasonCodes.map(code => reasonLabels[code] ?? code).join('；'));
  const data = node('dl', 'binding-list');
  const rows = [['工具版本', record.toolVersion ?? '未注册'], ['策略版本', record.policyVersion], ['主体 / 租户', `${record.subject.id} / ${record.subject.tenantId}`], ['许可到期', formatTime(record.expiresAt)], ['人工审批', record.approvedBy ?? '尚未批准']];
  for (const [label, value] of rows) { data.append(node('dt', '', label), node('dd', '', value)); }
  container.append(top, status, reason, data);
  if (record.matchedRuleIds.length) container.append(node('div', 'matched-rules', '命中规则：' + record.matchedRuleIds.join('、')));
  if (record.issues.length) container.append(node('div', 'matched-rules', '参数问题：' + record.issues.map(issue => `${issue.path} ${issue.code}`).join('；')));
  const details = node('details', 'preview'); details.append(node('summary', '', '查看脱敏绑定预览'), node('pre', '', JSON.stringify(record.preview, null, 2))); container.append(details);
  container.append(node('div', 'ticket-bottom', '参数、工具、主体、角色、租户、版本、到期时间共同绑定'));
}
function render() {
  $('#clock').textContent = formatTime(now); $('.policy-pill').textContent = gate.policyVersion;
  $('#scenarios').replaceChildren();
  for (const scenario of scenarios) { const button = node('button', `scenario ${scenario.id === selected ? 'selected' : ''}`); button.setAttribute('aria-pressed', String(scenario.id === selected)); const icon = node('span', 'scenario-icon', scenario.symbol); const text = node('span', 'scenario-copy'); text.append(node('strong', '', scenario.name), node('small', '', scenario.caption)); button.append(icon, text); button.addEventListener('click', () => setScenario(scenario.id)); $('#scenarios').append(button); }
  const known = tools.find(tool => tool.id === $('#tool-id').value); $('#tool-risk').textContent = known ? `${risks[known.risk]}操作` : '工具未注册';
  renderTicket();
  const body = $('#audit-body'); body.replaceChildren(); const audit = gate.audit();
  const eventLabels = { preflight: '完成风险预检', approved: '人工批准', rejected: '人工拒绝', consumed: '消费执行许可', expired: '许可过期', 'policy-invalidated': '策略变更失效', 'rejected-attempt': '拦截违规尝试' };
  for (const item of [...audit].reverse().slice(0, 30)) { const row = node('tr'); row.append(node('td', '', `${String(item.sequence).padStart(2, '0')} / ${formatTime(item.at).slice(-8)}`), node('td', '', item.actionId ?? '—'), node('td', '', item.actorId), node('td', item.event === 'rejected-attempt' ? 'audit-error' : '', eventLabels[item.event] ?? item.event), node('td', 'reason-code', item.code)); body.append(row); }
  if (!audit.length) { const row = node('tr'), cell = node('td', 'empty-audit', '暂无审计事件。运行一次预检，开始观察操作记录。'); cell.colSpan = 5; row.append(cell); body.append(row); }
}
$('#preflight').addEventListener('click', () => run(() => {
  const call = currentCall(); const record = gate.preflight(call, subject); currentId = record.id;
  try { preflightSnapshot = canonicalize(call); } catch { preflightSnapshot = null; }
  return record;
}, record => `预检完成：${states[record.state]}。${record.state === 'approval-required' ? '请核对左侧调用草稿，确认内容后在右侧审批。' : record.state === 'deny' ? '请检查拒绝原因，修改草稿后重新预检。' : '可消费一次许可。'}`));
$('#approve').addEventListener('click', () => run(() => {
  if (!currentId) throw new Error('请先运行风险预检');
  if (preflightSnapshot === null || canonicalize(currentCall()) !== preflightSnapshot) throw new GateError('DRAFT_CHANGED', '当前草稿与预检内容不一致，不能批准另一份内容。请重新预检，或恢复原始参数后再审批。');
  return gate.approve(currentId, reviewers[$('#reviewer').value]);
}, '审批已通过。可以消费原始草稿，或先修改参数验证绑定检查。'));
$('#reject').addEventListener('click', () => run(() => { if (!currentId) throw new Error('请先运行风险预检'); return gate.reject(currentId, reviewers[$('#reviewer').value]); }, '本次申请已拒绝；必须创建新的预检请求才能继续。'));
$('#consume').addEventListener('click', () => run(() => {
  if (!currentId) throw new Error('请先运行风险预检');
  const mode = $('#execution-subject').value;
  const actor = mode === 'revoked' ? { ...subject, roles: [] } : mode === 'foreign' ? { ...subject, tenantId: 'tenant-other' } : subject;
  return gate.consume(currentId, currentCall(), actor);
}, permit => `模拟执行成功：${permit.toolId} 的一次性许可已消费。没有发送邮件或变更设备；再点一次会被拒绝。`));
$('#mutate').addEventListener('click', () => { try { const args = JSON.parse($('#arguments').value); if ('body' in args) args.body += '\n补充：此段在预检后修改。'; else if ('query' in args) args.query += '（已修改）'; else if ('change' in args) args.change.reason += '（已修改）'; else args.claimedRisk = 'external'; $('#arguments').value = JSON.stringify(args, null, 2); feedback('参数已变更，未重新预检。原请求不能批准；若已批准，可尝试消费原许可验证绑定拒绝。'); } catch { feedback('JSON 格式有误，请先修正。', 'error'); } });
$('#big-batch').addEventListener('click', () => { setScenario('batch'); const args = JSON.parse($('#arguments').value); args.resourceIds = Array.from({ length: 32 }, (_, i) => `pump-${String(i + 1).padStart(3, '0')}`); $('#arguments').value = JSON.stringify(args, null, 2); feedback('已载入 32 台设备。运行预检将命中超过 20 台的拒绝规则。'); });
$('#advance').addEventListener('click', () => { now += 660_000; render(); feedback('演示时钟已推进 11 分钟；未消费许可按原始到期时间失效。'); });
$('#replace-policy').addEventListener('click', () => run(() => gate.replacePolicy({ ...policy, version: `harbor-policy-v${Number(gate.policyVersion.split('v').at(-1)) + 1}` }), '策略版本已更新，所有尚未消费的许可均已失效。'));
$('#reset').addEventListener('click', () => { now = initialTime; counter = 0; gate = createGate(); $('#reviewer').value = 'normal'; $('#execution-subject').value = 'normal'; setScenario('mail'); feedback('演示数据、时钟、策略、审批身份与审计记录已重置。'); });
$('#export').addEventListener('click', () => { const report = { exportedAt: new Date(now).toISOString(), simulation: true, note: '仅脱敏审计，不含原始工具参数，不代表工具实际执行', policyVersion: gate.policyVersion, audit: gate.audit() }; const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' })); const link = node('a'); link.href = url; link.download = 'action-gate-audit.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); feedback('脱敏审计 JSON 已生成。'); });
setScenario('mail');
