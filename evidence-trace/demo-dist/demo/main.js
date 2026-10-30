import { auditAnswer, exportAudit } from '../dist/index.js';
import { scenarios } from './scenarios.js';
const labels = { pass: '结构通过', review: '需要复核', block: '发布阻断' };
const symbols = { pass: '✓', review: '!', block: '×' };
const e = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let scenarioId = 'normal', selectedIndex = 0, citationIndex = 0, request, report;
const app = document.querySelector('#app');
app.innerHTML = `<header class="masthead"><a href="#" class="wordmark" aria-label="引证台首页"><span class="mark">“</span><span>引证台</span><small>回答证据审阅</small></a><div class="header-right"><span class="local-flag"><i></i>虚构数据 · 本地运行</span><button id="export" class="button">导出审计记录 <span aria-hidden="true">↓</span></button></div></header>
<main><section class="intro"><div><h1>每一句回答，都能回到出处。</h1><p>逐条核对来源、版本与原文范围，把需要复核的回答留在发布之前。</p></div><div class="review-note"><span class="note-symbol">⌕</span><p>引用结构检查<br><strong>不替代内容真实性与语义审核</strong></p></div></section>
<section class="scenario-bar" aria-label="选择演示场景"><span class="scenario-label">试一组输入</span><div class="scenario-buttons" id="scenarios"></div></section><p id="scenario-hint" class="scenario-hint" aria-live="polite"></p>
<section class="decision-strip" id="decision" aria-label="回答校验决策"></section>
<div class="workspace"><section class="answer-pane"><div class="pane-heading"><div><span class="section-icon">≡</span><h2>待发布回答</h2></div><span>3 条业务声明</span></div><div class="question"><span>用户提问</span><p>企业套餐的报修时段、巡检次数，以及替机申请流程是什么？</p></div><div class="claims" id="claims"></div><div class="answer-foot"><span class="tiny-line"></span><p>点击一条声明，在右侧查看对应原文与检查路径。</p></div></section>
<section class="source-pane" id="source-pane" aria-label="来源证据与检查路径"></section></div>
<section class="method-strip"><div><span>来源范围</span><strong>租户 + 许可列表</strong><p>未许可来源不返回元信息与正文</p></div><div><span>定位约定</span><strong>逐字匹配，明确范围</strong><p>不自动纠错，不猜测重复引文位置</p></div><div><span>人工边界</span><strong>结构通过 ≠ 事实正确</strong><p>数字、单位、否定与上下文仍需复核</p></div></section>
<footer><span>引证台 / Evidence Trace</span><span>青屿设备、服务规则及所有文档均为虚构 · 不调用模型或外部接口</span></footer></main><div id="toast" role="status" aria-live="polite"></div>`;
function setScenario(id) {
  scenarioId = id; request = scenarios[id].make(); report = auditAnswer(request); selectedIndex = 0; citationIndex = 0; render();
}
function render() {
  document.querySelector('#scenarios').innerHTML = Object.entries(scenarios).map(([id, scenario]) => `<button class="scenario-button ${id === scenarioId ? 'active' : ''}" data-scenario="${id}" aria-pressed="${id === scenarioId}">${scenario.label}</button>`).join('');
  document.querySelectorAll('[data-scenario]').forEach(b => b.addEventListener('click', () => setScenario(b.dataset.scenario)));
  document.querySelector('#scenario-hint').textContent = scenarios[scenarioId].hint;
  document.querySelector('#decision').className = `decision-strip ${report.decision}`;
  document.querySelector('#decision').innerHTML = `<div class="decision-main"><span class="decision-symbol">${symbols[report.decision]}</span><div><strong>${labels[report.decision]}</strong><p>${report.decision === 'pass' ? '所有必引声明均有可定位的证据；这不是事实真实性结论。' : report.decision === 'review' ? '已保留证据路径，需人工确认适用性后再决定发布。' : '存在无效或不可访问的证据，请修正后重新校验。'}</p></div></div><div class="summary"><span><b>${report.summary.coveredRequiredClaims}/${report.summary.requiredClaims}</b>必引覆盖</span><span><b>${report.summary.review}</b>需复核</span><span><b>${report.summary.block}</b>被阻断</span></div>`;
  document.querySelector('#claims').innerHTML = report.claims.map((claim, index) => `<button class="claim ${index === selectedIndex ? 'selected' : ''}" data-claim="${index}" aria-pressed="${index === selectedIndex}"><span class="claim-number">${index + 1}</span><div class="claim-copy"><div class="claim-top"><span>声明 ${index + 1}</span><span class="status ${claim.decision}">${symbols[claim.decision]} ${labels[claim.decision]}</span></div><p>${e(claim.text)}</p><div class="citation-pills">${claim.citations.map(citation => `<span class="citation-pill ${citation.source ? '' : 'unavailable'}">${citation.source ? `▧ ${e(citation.source.title)} <b>${e(citation.source.versionId)}</b>` : '▧ 来源不可用'}</span>`).join('')}</div><div class="claim-foot"><span>${claim.covered ? '已定位原文' : '缺少可用锚点'}</span><span>${index === selectedIndex ? '正在查看证据' : '查看证据'} <b>↗</b></span></div></div></button>`).join('');
  document.querySelectorAll('[data-claim]').forEach(b => b.addEventListener('click', () => { selectedIndex = Number(b.dataset.claim); citationIndex = 0; render(); }));
  renderSource();
}
function renderSource() {
  const claim = report.claims[selectedIndex], citation = claim.citations[citationIndex];
  const issues = [...claim.findings, ...citation.findings];
  const container = document.querySelector('#source-pane');
  let content;
  if (!citation.source) {
    content = `<div class="locked-source"><span class="lock-icon">▣</span><h3>当前范围无法读取此来源</h3><p>没有返回来源标题、版本、正文或引文。<br>请使用已授权且属于当前租户的文档。</p><span class="protected-label">来源边界已生效</span></div>`;
  } else {
    const anchor = citation.anchor, text = citation.document || '';
    const highlighted = anchor ? `${e(text.slice(0, anchor.start))}<mark>${e(text.slice(anchor.start, anchor.end))}</mark>${e(text.slice(anchor.end))}` : e(text);
    content = `<div class="document-toolbar"><div><span class="file-icon">▤</span><div><strong>${e(citation.source.title)}</strong><span>固定版本 ${e(citation.source.versionId)}${citation.source.currentVersionId ? `　当前登记 ${e(citation.source.currentVersionId)}` : ''}</span></div></div><span class="document-tag">虚构文档</span></div><div class="document"><div class="document-margin"><span>原文</span><i></i></div><pre>${highlighted || '当前版本正文不可用'}</pre></div><div class="anchor-bar"><span class="anchor-dot ${anchor ? 'located' : ''}"></span><strong>${anchor ? '引文已定位' : '引文未定位'}</strong><span>${anchor ? `[${anchor.start}, ${anchor.end}) · UTF-16 code unit` : '不猜测、不补写、不替换来源'}</span></div>`;
  }
  const accessOk = Boolean(citation.source), versionOk = citation.document !== undefined, anchorOk = Boolean(citation.anchor);
  const timingIssues = citation.findings.filter(f => ['DOCUMENT_WITHDRAWN', 'VERSION_WITHDRAWN', 'VERSION_NOT_YET_VALID', 'VERSION_EXPIRED', 'VERSION_SUPERSEDED'].includes(f.code));
  const checks = [
    { name: '来源访问范围', state: accessOk ? 'pass' : 'block', detail: accessOk ? '租户与许可列表匹配' : '不可用，停止来源读取' },
    { name: '固定版本', state: versionOk ? 'pass' : accessOk ? 'block' : 'skip', detail: versionOk ? '版本存在，未回退其他版本' : '未取得可校验版本' },
    { name: '原文锚点', state: anchorOk ? 'pass' : accessOk ? (citation.decision === 'block' ? 'block' : 'review') : 'skip', detail: anchorOk ? '引文与原文完全一致' : '没有可用的精确定位' },
    { name: '时效与撤回', state: !versionOk ? 'skip' : timingIssues.some(f => f.level === 'block') ? 'block' : timingIssues.length ? 'review' : 'pass', detail: !versionOk ? '未读取来源，不执行检查' : timingIssues.length ? timingIssues[0].message : '在检查时点可用' },
  ];
  container.innerHTML = `<div class="pane-heading"><div><span class="section-icon">“</span><h2>来源证据</h2></div><span>对应声明 ${selectedIndex + 1}</span></div>${claim.citations.length > 1 ? `<div class="citation-tabs">${claim.citations.map((c, i) => `<button data-citation="${i}" class="${i === citationIndex ? 'selected' : ''}">引用 ${i + 1}</button>`).join('')}</div>` : ''}${content}<div class="check-path"><div class="path-heading"><h3>这条证据如何被检查</h3><span>确定性规则</span></div><div class="check-list">${checks.map(check => `<div class="check-item"><span class="check-circle ${check.state}">${check.state === 'skip' ? '—' : symbols[check.state]}</span><div><strong>${check.name}</strong><span>${e(check.detail)}</span></div></div>`).join('')}</div>${issues.length ? `<div class="issues">${issues.map(issue => `<div class="issue ${issue.level}"><span>${symbols[issue.level]}</span><div><strong>${e(issue.code)}</strong><p>${e(issue.message)}</p></div></div>`).join('')}</div>` : '<p class="no-issues">未发现引用结构问题。引用是否支持这句话的含义，仍由人工或独立语义审核流程判断。</p>'}${claim.numericCheck.performed ? `<p class="number-note">数字粗检：${claim.numericCheck.missingTokens.length ? `声明中的 ${claim.numericCheck.missingTokens.map(e).join('、')} 未在可用引文找到。` : '未发现缺失的数字标记。'} 此检查不核验单位、计算、范围或语义。</p>` : ''}</div>`;
  container.querySelectorAll('[data-citation]').forEach(button => button.addEventListener('click', () => { citationIndex = Number(button.dataset.citation); renderSource(); }));
}
document.querySelector('#export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([exportAudit(report)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `evidence-audit-${scenarioId}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const toast = document.querySelector('#toast'); toast.textContent = '已导出当前审计结果；不包含未授权来源内容。'; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3500);
});
setScenario('normal');
