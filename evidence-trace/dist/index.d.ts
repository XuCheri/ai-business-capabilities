/** Structural citation auditing. A pass is NOT a truth or entailment verdict. */
export type Decision = 'pass' | 'review' | 'block';
export type FindingLevel = 'review' | 'block';
export type FindingCode = 'REQUIRED_CITATION_MISSING' | 'SOURCE_UNAVAILABLE' | 'VERSION_NOT_FOUND' | 'DOCUMENT_WITHDRAWN' | 'VERSION_WITHDRAWN' | 'VERSION_NOT_YET_VALID' | 'VERSION_EXPIRED' | 'VERSION_SUPERSEDED' | 'QUOTE_NOT_FOUND' | 'QUOTE_AMBIGUOUS' | 'ANCHOR_INVALID' | 'ANCHOR_MISMATCH' | 'NUMERIC_TOKEN_MISSING' | 'MIXED_VERSIONS';
export interface Finding {
    code: FindingCode;
    level: FindingLevel;
    message: string;
}
export interface SourceVersion {
    id: string;
    /** Immutable extracted plain text. UTF-16 offsets apply to this exact string. */
    text: string;
    validFrom?: number;
    /** Exclusive validity boundary: at >= validUntil requires review. */
    validUntil?: number;
    withdrawnAt?: number;
}
export interface EvidenceSource {
    id: string;
    tenantId: string;
    title: string;
    currentVersionId?: string;
    withdrawnAt?: number;
    versions: SourceVersion[];
}
export interface Citation {
    sourceId: string;
    versionId: string;
    quote: string;
    /** Half-open [start,end) UTF-16 code unit offsets; no normalization is performed. */
    anchor?: {
        start: number;
        end: number;
    };
}
export interface Claim {
    id: string;
    text: string;
    /** Trusted service policy, never accept a model-authored bypass flag. */
    requiresCitation: boolean;
    citations: Citation[];
}
export interface AuditRequest {
    answerId: string;
    /** Must be derived from a trusted session by the integrating service. */
    tenantId: string;
    /** Server-derived allowlist. The core does not authenticate this field. */
    allowedSourceIds: string[];
    sources: EvidenceSource[];
    claims: Claim[];
    /** Deterministic audit time in Unix milliseconds. */
    at: number;
    checkNumbers?: boolean;
}
export interface VerifiedAnchor {
    start: number;
    end: number;
    offsetUnit: 'utf16-code-unit';
    /** Authorized exact quote only. */
    quote: string;
}
export interface CitationResult {
    index: number;
    decision: Decision;
    findings: Finding[];
    /** Omitted entirely for unavailable/unauthorized sources. */
    source?: {
        id: string;
        title: string;
        versionId: string;
        currentVersionId?: string;
    };
    anchor?: VerifiedAnchor;
    /** Complete authorized pinned-version text for UI highlighting. */
    document?: string;
}
export interface ClaimResult {
    id: string;
    /** Caller-provided claim text, not source content. */
    text: string;
    requiresCitation: boolean;
    decision: Decision;
    findings: Finding[];
    citations: CitationResult[];
    /** Structural coverage: at least one non-blocked, exact anchored citation. */
    covered: boolean;
    numericCheck: {
        performed: boolean;
        missingTokens: string[];
    };
}
export interface AuditReport {
    schemaVersion: 1;
    answerId: string;
    tenantId: string;
    auditedAt: number;
    decision: Decision;
    policy: {
        offsetUnit: 'utf16-code-unit';
        exactMatch: true;
        numbersAreHeuristic: true;
        semanticEntailmentChecked: false;
    };
    summary: {
        claims: number;
        requiredClaims: number;
        coveredRequiredClaims: number;
        pass: number;
        review: number;
        block: number;
        citations: number;
    };
    claims: ClaimResult[];
    /** Only references already permitted by both tenant and the supplied allowlist. */
    versionConflicts: Array<{
        sourceId: string;
        versions: string[];
        claimIds: string[];
    }>;
}
export declare class EvidenceInputError extends Error {
    readonly code = "INVALID_INPUT";
    constructor(message: string);
}
export declare function auditAnswer(input: AuditRequest): AuditReport;
/** Serialization only. Pass the unmodified auditAnswer result; this is NOT an independent sanitizer. */
export declare function exportAudit(report: AuditReport): string;
//# sourceMappingURL=index.d.ts.map