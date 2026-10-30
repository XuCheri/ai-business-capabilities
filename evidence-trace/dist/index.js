export class EvidenceInputError extends Error {
    code = 'INVALID_INPUT';
    constructor(message) { super(message); this.name = 'EvidenceInputError'; }
}
const fail = (message) => { throw new EvidenceInputError(message); };
function nonempty(value, field) {
    if (typeof value !== 'string' || !value.trim())
        fail(`${field} 必须为非空字符串`);
}
function stamp(value, field) {
    if (!Number.isSafeInteger(value) || value < 0)
        fail(`${field} 必须为非负安全整数时间戳`);
}
function checkRequest(input) {
    if (!input || typeof input !== 'object')
        fail('请求必须为对象');
    nonempty(input.answerId, 'answerId');
    nonempty(input.tenantId, 'tenantId');
    stamp(input.at, 'at');
    if (!Array.isArray(input.allowedSourceIds) || !Array.isArray(input.sources) || !Array.isArray(input.claims))
        fail('sources、claims 和 allowedSourceIds 必须为数组');
    if (input.claims.length === 0)
        fail('claims 至少包含一条声明');
    if (input.checkNumbers !== undefined && typeof input.checkNumbers !== 'boolean')
        fail('checkNumbers 必须为布尔值');
    input.allowedSourceIds.forEach(id => nonempty(id, 'allowedSourceIds[]'));
    const claimIds = new Set();
    for (const claim of input.claims) {
        if (!claim || typeof claim !== 'object')
            fail('声明必须为对象');
        nonempty(claim.id, 'claim.id');
        nonempty(claim.text, 'claim.text');
        if (claimIds.has(claim.id))
            fail('claim.id 不可重复');
        claimIds.add(claim.id);
        if (typeof claim.requiresCitation !== 'boolean' || !Array.isArray(claim.citations))
            fail('声明必须提供 requiresCitation 和 citations');
        for (const citation of claim.citations) {
            if (!citation || typeof citation !== 'object')
                fail('引用必须为对象');
            nonempty(citation.sourceId, 'citation.sourceId');
            nonempty(citation.versionId, 'citation.versionId');
            nonempty(citation.quote, 'citation.quote');
            if (citation.anchor !== undefined && (!citation.anchor || typeof citation.anchor !== 'object'))
                fail('anchor 必须为对象');
        }
    }
    const keys = new Set();
    for (const source of input.sources) {
        if (!source || typeof source !== 'object')
            fail('来源必须为对象');
        nonempty(source.id, 'source.id');
        nonempty(source.tenantId, 'source.tenantId');
        nonempty(source.title, 'source.title');
        const key = JSON.stringify([source.tenantId, source.id]);
        if (keys.has(key))
            fail('同租户来源 ID 不可重复');
        keys.add(key);
        if (!Array.isArray(source.versions))
            fail('source.versions 必须为数组');
        if (source.withdrawnAt !== undefined)
            stamp(source.withdrawnAt, 'source.withdrawnAt');
        const versions = new Set();
        for (const version of source.versions) {
            if (!version || typeof version !== 'object')
                fail('版本必须为对象');
            nonempty(version.id, 'version.id');
            if (typeof version.text !== 'string')
                fail('version.text 必须为字符串');
            if (versions.has(version.id))
                fail('同一来源的版本 ID 不可重复');
            versions.add(version.id);
            for (const value of [version.validFrom, version.validUntil, version.withdrawnAt])
                if (value !== undefined)
                    stamp(value, '版本时间');
            if (version.validFrom !== undefined && version.validUntil !== undefined && version.validUntil <= version.validFrom)
                fail('版本有效期必须为非空区间');
        }
        if (source.currentVersionId !== undefined && !versions.has(source.currentVersionId))
            fail('currentVersionId 必须指向已登记版本');
    }
}
const finding = (code, level, message) => ({ code, level, message });
function decision(findings) {
    return findings.some(f => f.level === 'block') ? 'block' : findings.length ? 'review' : 'pass';
}
function isBoundary(text, offset) {
    if (offset === 0 || offset === text.length)
        return true;
    const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
    return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}
/** Literal numeric tokens only; no units, signs, ranges, arithmetic or semantic inference. */
function numbers(text) { return [...new Set(text.match(/\d+(?:[.,]\d+)*(?:%|％)?/g) ?? [])]; }
function locate(text, citation) {
    if (citation.anchor) {
        const { start, end } = citation.anchor;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > text.length ||
            !isBoundary(text, start) || !isBoundary(text, end)) {
            return { issues: [finding('ANCHOR_INVALID', 'block', '引文范围无效或切开 Unicode 代理对；请重新定位原文范围')] };
        }
        if (text.slice(start, end) !== citation.quote)
            return { issues: [finding('ANCHOR_MISMATCH', 'block', '指定范围的原文与引文不完全相同')] };
        return { anchor: { start, end, offsetUnit: 'utf16-code-unit', quote: citation.quote }, issues: [] };
    }
    const start = text.indexOf(citation.quote);
    if (start < 0)
        return { issues: [finding('QUOTE_NOT_FOUND', 'block', '在指定版本中没有找到完全相同的引文')] };
    const end = start + citation.quote.length;
    if (!isBoundary(text, start) || !isBoundary(text, end))
        return { issues: [finding('ANCHOR_INVALID', 'block', '引文切开 Unicode 代理对，请选择完整字符')] };
    if (text.indexOf(citation.quote, start + 1) >= 0)
        return { issues: [finding('QUOTE_AMBIGUOUS', 'review', '同一引文在版本中出现多次；请提供明确范围，当前未选择任一锚点')] };
    return { anchor: { start, end, offsetUnit: 'utf16-code-unit', quote: citation.quote }, issues: [] };
}
export function auditAnswer(input) {
    checkRequest(input);
    const allowed = new Set(input.allowedSourceIds);
    // After trusted-registry schema validation, restrict lookup before source/version/quote inspection.
    const registry = new Map(input.sources.filter(s => s.tenantId === input.tenantId && allowed.has(s.id)).map(s => [s.id, s]));
    const refs = new Map();
    const results = input.claims.map(claim => {
        const claimFindings = [];
        if (claim.requiresCitation && claim.citations.length === 0)
            claimFindings.push(finding('REQUIRED_CITATION_MISSING', 'block', '该声明要求证据，但没有提供引用'));
        const citations = claim.citations.map((citation, index) => {
            const source = registry.get(citation.sourceId);
            if (!source)
                return { index, decision: 'block', findings: [finding('SOURCE_UNAVAILABLE', 'block', '来源不可用或当前范围不允许访问；未返回任何来源内容')] };
            const version = source.versions.find(v => v.id === citation.versionId);
            if (!version)
                return { index, decision: 'block', findings: [finding('VERSION_NOT_FOUND', 'block', '已授权来源中不存在请求的版本')],
                    source: { id: source.id, title: source.title, versionId: citation.versionId, currentVersionId: source.currentVersionId } };
            const seen = refs.get(source.id) ?? new Map();
            const claims = seen.get(version.id) ?? new Set();
            claims.add(claim.id);
            seen.set(version.id, claims);
            refs.set(source.id, seen);
            const findings = [];
            if (source.withdrawnAt !== undefined && input.at >= source.withdrawnAt)
                findings.push(finding('DOCUMENT_WITHDRAWN', 'block', '该文档已撤回，不能继续作为发布证据'));
            if (version.withdrawnAt !== undefined && input.at >= version.withdrawnAt)
                findings.push(finding('VERSION_WITHDRAWN', 'block', '该版本已撤回，不能继续作为发布证据'));
            if (version.validFrom !== undefined && input.at < version.validFrom)
                findings.push(finding('VERSION_NOT_YET_VALID', 'block', '引用版本尚未生效'));
            if (version.validUntil !== undefined && input.at >= version.validUntil)
                findings.push(finding('VERSION_EXPIRED', 'review', '引用版本已到有效期边界，需要核查新版本或人工确认'));
            if (source.currentVersionId !== undefined && source.currentVersionId !== version.id)
                findings.push(finding('VERSION_SUPERSEDED', 'review', '引用未指向登记的当前版本，需要人工确认适用性'));
            const location = locate(version.text, citation);
            findings.push(...location.issues);
            return { index, decision: decision(findings), findings, source: { id: source.id, title: source.title,
                    versionId: version.id, currentVersionId: source.currentVersionId }, document: version.text, ...(location.anchor ? { anchor: location.anchor } : {}) };
        });
        // Numeric hints use only anchored, non-blocked evidence. Never inspect forbidden text.
        const usable = citations.filter(c => c.anchor && c.decision !== 'block');
        const numericPerformed = input.checkNumbers !== false && usable.length > 0;
        const evidenceTokens = new Set(usable.flatMap(c => numbers(c.anchor.quote)));
        const missingTokens = numericPerformed ? numbers(claim.text).filter(n => !evidenceTokens.has(n)) : [];
        if (missingTokens.length)
            claimFindings.push(finding('NUMERIC_TOKEN_MISSING', 'review', '声明中存在未在可用引文中找到的数字标记，需要人工核对数值、单位与上下文'));
        return { id: claim.id, text: claim.text, requiresCitation: claim.requiresCitation, decision: 'pass', findings: claimFindings,
            citations, covered: usable.length > 0, numericCheck: { performed: numericPerformed, missingTokens } };
    });
    const versionConflicts = [];
    for (const [sourceId, versions] of refs) {
        if (versions.size <= 1)
            continue;
        const claimIds = [...new Set([...versions.values()].flatMap(ids => [...ids]))];
        versionConflicts.push({ sourceId, versions: [...versions.keys()], claimIds });
        for (const result of results)
            if (claimIds.includes(result.id))
                result.findings.push(finding('MIXED_VERSIONS', 'review', '同一回答引用了同一文档的多个版本；这提示版本混用，不等于已证明内容矛盾'));
    }
    for (const result of results) {
        if (result.requiresCitation && result.citations.length > 0 && !result.covered && !result.findings.some(f => f.level === 'block') &&
            !result.citations.some(c => c.decision === 'block')) {
            result.findings.push(finding('REQUIRED_CITATION_MISSING', 'review', '该声明尚无唯一可定位的引文，需补齐明确锚点'));
        }
        result.decision = decision([...result.findings, ...result.citations.flatMap(c => c.findings)]);
    }
    const allFindings = results.flatMap(c => [...c.findings, ...c.citations.flatMap(citation => citation.findings)]);
    return { schemaVersion: 1, answerId: input.answerId, tenantId: input.tenantId, auditedAt: input.at,
        decision: decision(allFindings), policy: { offsetUnit: 'utf16-code-unit', exactMatch: true, numbersAreHeuristic: true, semanticEntailmentChecked: false },
        summary: { claims: results.length, requiredClaims: results.filter(c => c.requiresCitation).length,
            coveredRequiredClaims: results.filter(c => c.requiresCitation && c.covered).length,
            pass: results.filter(c => c.decision === 'pass').length, review: results.filter(c => c.decision === 'review').length,
            block: results.filter(c => c.decision === 'block').length, citations: results.reduce((n, c) => n + c.citations.length, 0) },
        claims: results, versionConflicts };
}
/** Serialization only. Pass the unmodified auditAnswer result; this is NOT an independent sanitizer. */
export function exportAudit(report) { return JSON.stringify(report, null, 2); }
//# sourceMappingURL=index.js.map