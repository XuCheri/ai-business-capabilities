// 所有机构、制度、数值与来源均为虚构，仅用于复现校验规则。
export const auditTime = Date.UTC(2026, 9, 30, 2, 0, 0);
const firstQuote = '标准报修受理时段为工作日09:00至18:00。';
const secondQuote = '企业套餐每年包含4次上门巡检，未使用次数不跨年度结转。';
const thirdQuote = '替机申请须先完成设备故障登记，再由服务专员确认库存。';
const serviceText = `青屿设备服务手册\n版本 2026.2｜演示文档\n\n适用范围\n本文适用于青屿设备的企业服务套餐，全部规则均为虚构。\n\n报修受理\n${firstQuote}\n非受理时段可登记申请，人工受理于下一个工作日开始。\n\n巡检权益\n${secondQuote}\n巡检需提前与服务专员预约，具体到场时间以确认结果为准。`;
const replacementText = `青屿设备替机申请指引\n版本 2026.1｜演示文档\n\n办理条件\n${thirdQuote}\n替机是否提供取决于库存与套餐范围，不承诺当日发出。\n\n留存记录\n服务专员须记录设备编号、登记时间与库存核查结果。`;
function normal() {
  return {
    answerId: 'answer-qy-1030', tenantId: 'qingyu-demo', at: auditTime,
    allowedSourceIds: ['service-guide', 'replacement-guide'],
    sources: [
      { id: 'service-guide', tenantId: 'qingyu-demo', title: '青屿设备服务手册', currentVersionId: '2026.2',
        versions: [{ id: '2026.2', text: serviceText, validFrom: Date.UTC(2026, 6, 1), validUntil: Date.UTC(2027, 0, 1) },
          { id: '2026.1', text: '旧版巡检权益\n企业套餐每年包含2次上门巡检。', validFrom: Date.UTC(2026, 0, 1), validUntil: Date.UTC(2026, 6, 1) }] },
      { id: 'replacement-guide', tenantId: 'qingyu-demo', title: '青屿设备替机申请指引', currentVersionId: '2026.1',
        versions: [{ id: '2026.1', text: replacementText, validFrom: Date.UTC(2026, 0, 1) }] },
      { id: 'private-approval', tenantId: 'other-tenant', title: '不可访问的演示来源标题', versions: [{ id: 'private-1', text: 'PRIVATE_DEMO_MARKER：其他租户的虚构审批记录。' }] },
    ],
    claims: [
      { id: 'claim-hours', text: '标准报修受理时段为工作日09:00至18:00。', requiresCitation: true, citations: [{ sourceId: 'service-guide', versionId: '2026.2', quote: firstQuote }] },
      { id: 'claim-visits', text: '企业套餐每年包含4次上门巡检，未使用次数不跨年度结转。', requiresCitation: true, citations: [{ sourceId: 'service-guide', versionId: '2026.2', quote: secondQuote }] },
      { id: 'claim-replacement', text: '申请替机时，需要先登记设备故障，再由服务专员确认库存。', requiresCitation: true, citations: [{ sourceId: 'replacement-guide', versionId: '2026.1', quote: thirdQuote }] },
    ],
  };
}
export const scenarios = {
  normal: { label: '完整引用', hint: '三条声明均能回到有效且已授权的原文。', make: normal },
  forged: { label: '伪造引文', hint: '回答声称全年无休，提供的引文却不在文档中。', make: () => {
    const r = normal(); r.claims[0].text = '标准报修受理时段为全年每日09:00至18:00。';
    r.claims[0].citations[0].quote = r.claims[0].text; return r;
  } },
  expired: { label: '来源过期', hint: '引文仍能定位，但引用版本已到期，转交人工复核。', make: () => {
    const r = normal(); r.sources[0].versions[0].validUntil = auditTime; return r;
  } },
  forbidden: { label: '跨租户引用', hint: '来源不在当前租户和许可范围内；不返回其标题、正文或引文。', make: () => {
    const r = normal(); r.claims[2].text = '当前申请适用特殊审批规则。';
    r.claims[2].citations = [{ sourceId: 'private-approval', versionId: 'private-1', quote: 'PRIVATE_DEMO_MARKER：其他租户的虚构审批记录。' }]; return r;
  } },
  mixed: { label: '版本混用', hint: '同一回答同时使用新旧巡检规则，提示版本混用与过期。', make: () => {
    const r = normal(); r.claims[2] = { id: 'claim-old', text: '旧套餐每年包含2次上门巡检。', requiresCitation: true,
      citations: [{ sourceId: 'service-guide', versionId: '2026.1', quote: '企业套餐每年包含2次上门巡检。' }] }; return r;
  } },
  numbers: { label: '数值待核对', hint: '回答写成8次，但原文为4次；只提示数字不一致，不推断语义。', make: () => {
    const r = normal(); r.claims[1].text = '企业套餐每年包含8次上门巡检。'; return r;
  } },
  withdrawn: { label: '文档撤回', hint: '已撤回文档即使引文匹配，也不得继续作为发布证据。', make: () => {
    const r = normal(); r.sources[1].withdrawnAt = auditTime; return r;
  } },
};
