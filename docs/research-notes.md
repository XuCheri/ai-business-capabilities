# AI 原子能力：官方资料与设计边界

查阅日期：2026-10-30。范围：`evidence-trace` 引用证据校验、`action-gate` 工具动作授权门禁。本文仅使用原始官方资料；下列设计建议是本项目据资料作出的工程判断，不是厂商认证或对标准的完整实现声明。文档会更新，后续接入真实服务前应再次核对。

## 1. Claude 引用能力

**来源：** Anthropic / Claude Platform Docs, *Citations*。
**链接：** https://platform.claude.com/docs/en/build-with-claude/citations
**查阅：** 2026-10-30。

资料要点：引用指向提供给模型的具体文档位置。纯文本使用从 0 开始的字符区间，结束索引不包含在内；PDF 使用从 1 开始的页区间，结束页同样不包含在内；自定义内容使用从 0 开始的块区间。正文可引用，标题和 context 元数据不算可引用正文。官方 API 的有效位置指针保证不能外推成任意本地实现的事实正确性保证。[官方说明](https://platform.claude.com/docs/en/build-with-claude/citations)

对 `evidence-trace` 的工程建议：

- 定义本地证据协议的文档 ID、版本、索引单位和半开区间语义；如果采用 JavaScript UTF-16，显式说明并验证 emoji 边界。该页的 character indices 说明不能作为其等同 JavaScript UTF-16 的证据。
- 校验源文档是否存在、版本是否对应、区间是否为整数且有效、引用文字是否与原始切片一致；保留可检查的错误原因。
- 区分“引用定位完整”“原文确有这段文字”“该文字支持这一结论”“现实事实为真”。前两项可由确定性代码校验，后两项需要独立证据与语义评估。
- 例如原文“检验不合格”被引用来支持“检验合格”，位置和引文均可能有效，结论仍然错误。应把这种案例作为能力边界演示。
- 不把自定义结构称为已实现 Claude 原生 API adapter；未进行真实服务调用时，不宣称 provider 兼容性或模型效果已验收。
- “哪些声明必须附证据”应由可信应用策略决定，不能由模型通过 `requiresCitation: false` 自行豁免。导出安全性应建立在净化后的审查结果上，普通 JSON 序列化函数本身不构成敏感信息过滤器。

## 2. OWASP 提示注入

**来源：** OWASP Gen AI Security Project, *LLM01:2025 Prompt Injection*。
**链接：** https://genai.owasp.org/llmrisk/llm01-prompt-injection/
**查阅：** 2026-10-30。

资料要点：外部网页、文件等内容可能携带间接提示注入；RAG 和微调不能完整消除该风险。缓解措施包括分离不可信内容、限制模型权限、用确定性代码检查输出格式、为高风险动作设置人工批准，并用对抗场景验证信任边界。[官方说明](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)

对两项能力的工程建议：

- 检索文本、引用原文、工具响应中的指令都是待处理数据，不可直接增加工具权限或审批状态。
- 若 `evidence-trace` 展示“忽略之前要求”等模式命中，只能称规则提示或风险线索；关键词未命中不能证明无提示注入。
- `action-gate` 让不可信的模型动作建议进入受控规则校验，不能依靠模型自报“安全”“只读”“用户已同意”放行。
- 不宣传“消除幻觉”“完全防止提示注入”或“可证明回答真实”。

## 3. OWASP 过度代理权限

**来源：** OWASP Gen AI Security Project, *LLM06:2025 Excessive Agency*。
**链接：** https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
**查阅：** 2026-10-30。

资料要点：过多功能、过大权限和过高自主性会放大模型错误或被操纵后的损害。建议缩小工具范围，在用户授权上下文中以最小权限运行，高影响动作经批准，并在下游系统对每次请求实施授权。日志和限流可以减少损害，但不能代替授权。[官方说明](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)

对 `action-gate` 的工程建议：

- 用可信工具注册表与策略决定动作风险；拒绝未知工具、未知参数、越权主体、错误租户和无授权目标。
- 审批必须绑定所展示的具体工具、参数、主体、租户及策略版本。参数、工具版本或权限变化后，应重新评估，而非复用旧许可。
- 票据应有有效期并一次性消费；重放、并发消费、审批到执行期间的参数变化需要明确合同。
- 浏览器内演示的签名或随机 ID 不等于服务端身份认证。正式环境需把门禁接入唯一执行入口，使用可信身份、服务端时钟、持久化原子消费和下游授权；否则调用方可绕开前端演示。

## 4. MCP 工具元数据与用户控制

**来源 A：** Model Context Protocol, *Tools*, specification **2025-11-25**。
**链接：** https://modelcontextprotocol.io/specification/2025-11-25/server/tools
**查阅：** 2026-10-30。

资料要点：工具可由模型发现和调用，但 UI 应显示可用工具和调用状态，并让人能够拒绝操作。工具 annotations 描述行为；除非来自可信服务端，否则客户端必须把这些注解视为不可信。[Tools 规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

**来源 B：** Model Context Protocol, *Specification*, version **2025-11-25**, Security and Trust & Safety。
**链接：** https://modelcontextprotocol.io/specification/2025-11-25
**查阅：** 2026-10-30。

资料要点：用户应理解并控制数据访问和动作，宿主需要实现同意、授权、隐私和访问控制流程；协议本身不能强制实现这些安全原则。[规范安全原则](https://modelcontextprotocol.io/specification/2025-11-25)

对 `action-gate` 的工程建议：

- `readOnlyHint`、`destructiveHint`、`idempotentHint` 等提示不应覆盖应用维护的可信策略；来源不可信的 annotations 只能做展示或触发更保守的检查。
- 用审批 UI 展示实际目标、动作影响、参数、有效期和审批者；许可必须来自受信任的应用流程，不能从模型文本中解析“已批准”。
- 清楚声明本项目是本地门禁规则库与模拟流程；除非另有真实协议适配和端到端验证，不宣称已经是 MCP 服务端、MCP 客户端或认证实现。

## 5. 后续独立审查清单

以下是本项目审查计划，完成情况以实际测试和审查记录为准。

| 组件 | 应验证的可观测行为 |
| --- | --- |
| evidence-trace | 文档 ID / 版本不匹配、负数/小数/NaN/越界位置、空引文、原文不符、Unicode 边界、重复引用与覆盖率口径、不可信来源、准确引用却不支持结论的边界案例。 |
| action-gate | 未知工具和参数、目录/域名/路径授权边界、伪造低风险标签、跨主体/跨租户票据、参数变化、过期、重放、重复/并发消费、策略变化、错误审批不产生可执行许可。 |
| 两者共同 | 确定性示例明确标为模拟；不收集模型密钥；展示文本不执行 HTML/脚本；审计记录与真实外部执行结果分开；未接入真实 LLM、后端和生产授权不得写成已验证。 |

本文不包含真实 LLM 调用结果、生产安全认证或通用攻击防御保证。
