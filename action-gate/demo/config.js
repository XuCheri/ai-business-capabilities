export const subject = { id: 'operator-lin', tenantId: 'tenant-harbor', roles: ['operator'] };
const text = (minLength = 1, maxLength = 200) => ({ type: 'string', minLength, maxLength });
const tenant = { type: 'string', enum: ['tenant-harbor', 'tenant-other'] };
export const tools = [
  { id: 'knowledge.search', version: '1.0.0', label: '检索内部知识', risk: 'read',
    requesterRoles: ['operator'], approverRoles: ['approver'], tenantArgumentPath: ['tenantId'],
    schema: { type: 'object', required: ['tenantId', 'query', 'limit'], properties: { tenantId: tenant, query: text(1, 200), limit: { type: 'integer', minimum: 1, maximum: 20 } } } },
  { id: 'mail.send', version: '1.2.0', label: '向外部发送邮件', risk: 'external',
    requesterRoles: ['operator'], approverRoles: ['approver'], tenantArgumentPath: ['tenantId'],
    schema: { type: 'object', required: ['tenantId', 'to', 'subject', 'body'], properties: { tenantId: tenant, to: text(1, 200), subject: text(1, 100), body: { ...text(1, 4000), sensitive: true } } } },
  { id: 'asset.batchUpdate', version: '2.0.0', label: '批量更新设备状态', risk: 'write',
    requesterRoles: ['operator'], approverRoles: ['approver'], tenantArgumentPath: ['tenantId'],
    schema: { type: 'object', required: ['tenantId', 'resourceIds', 'change'], properties: { tenantId: tenant,
      resourceIds: { type: 'array', minItems: 1, maxItems: 100, items: text(1, 64) },
      change: { type: 'object', required: ['status', 'reason'], properties: { status: { type: 'string', enum: ['maintenance', 'disabled'] }, reason: { ...text(1, 500), sensitive: true } } }
    } } }
];
export const policy = { version: 'harbor-policy-v1', ttlMs: 600_000, rules: [
  { id: 'external-recipient-allowlist', effect: 'deny', toolIds: ['mail.send'], conditions: [{ path: ['to'], operator: 'not-in', value: ['service@partner.example.test'] }] },
  { id: 'batch-limit-20', effect: 'deny', toolIds: ['asset.batchUpdate'], conditions: [{ path: ['resourceIds'], operator: 'array-length-greater-than', value: 20 }] },
  { id: 'disable-assets-denied', effect: 'deny', toolIds: ['asset.batchUpdate'], conditions: [{ path: ['change', 'status'], operator: 'equals', value: 'disabled' }] }
] };
export const scenarios = [
  { id: 'read', name: '内部知识检索', caption: '受控读取，可直接放行', symbol: '⌕', toolId: 'knowledge.search', args: { tenantId: 'tenant-harbor', query: '泵站巡检操作规程', limit: 5 } },
  { id: 'mail', name: '外部邮件发送', caption: '人工审核收件人与内容', symbol: '↗', toolId: 'mail.send', args: { tenantId: 'tenant-harbor', to: 'service@partner.example.test', subject: '本周巡检安排确认', body: '请确认周五的巡检窗口。此内容为虚构演示，不会实际发送。' } },
  { id: 'batch', name: '批量设备变更', caption: '数量阈值与独立审批', symbol: '▦', toolId: 'asset.batchUpdate', args: { tenantId: 'tenant-harbor', resourceIds: Array.from({ length: 8 }, (_, i) => `pump-${String(i + 1).padStart(3, '0')}`), change: { status: 'maintenance', reason: '演示：按计划切换到维护状态' } } },
  { id: 'unknown', name: '未注册工具', caption: '模型自报安全也不放行', symbol: '?', toolId: 'filesystem.erase', args: { tenantId: 'tenant-harbor', path: '/demo-only', claimedRisk: 'read' } }
];
export const reviewers = {
  normal: { id: 'reviewer-zhou', tenantId: 'tenant-harbor', roles: ['approver'] },
  self: { id: 'operator-lin', tenantId: 'tenant-harbor', roles: ['operator', 'approver'] },
  foreign: { id: 'reviewer-chen', tenantId: 'tenant-other', roles: ['approver'] },
  viewer: { id: 'viewer-wu', tenantId: 'tenant-harbor', roles: ['viewer'] }
};
