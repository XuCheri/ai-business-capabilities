from pathlib import Path
root=Path(__file__).resolve().parent.parent
entries=[('evidence-trace','知识库回答引用校验','与证据追溯','#1c4b7b','#e7f0f8','回答论断','来源版本','原文锚点',['版本一致性','访问范围','逐句证据链'],'让每一句业务回答，都能找到可复核的出处'),('action-gate','AI 工具调用风险预检','与审批门控','#6b407a','#f0e9f4','动作提议','风险预检','绑定审批',['参数绑定','许可过期','一次性消费'],'把 AI 的动作提议，变成可审阅的授权流程')]
for slug,line1,line2,accent,tint,a,b,c,chips,desc in entries:
 svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#f8fafc"/><rect width="18" height="675" fill="{accent}"/><g font-family="PingFang SC, Microsoft YaHei, sans-serif"><text x="70" y="85" fill="{accent}" font-size="22" font-weight="600">AI 业务原子能力</text><text x="70" y="174" fill="#17283d" font-size="48" font-weight="700">{line1}</text><text x="70" y="238" fill="#17283d" font-size="48" font-weight="700">{line2}</text><text x="70" y="293" fill="#52667c" font-size="22">{desc}</text>'''
 for i,label in enumerate([a,b,c]):
  x=70+i*365
  svg+=f'<rect x="{x}" y="359" width="310" height="108" rx="14" fill="{tint}" stroke="{accent}" stroke-width="1.5"/><text x="{x+155}" y="423" fill="{accent}" font-size="26" text-anchor="middle" font-weight="600">{label}</text>'
  if i<2: svg+=f'<path d="M{x+323} 413H{x+351}m-8-7 8 7-8 7" stroke="{accent}" stroke-width="2.5" fill="none"/>'
 for i,label in enumerate(chips):
  svg+=f'<circle cx="{84+i*310}" cy="529" r="5" fill="{accent}"/><text x="{100+i*310}" y="537" font-size="21" fill="#40576e">{label}</text>'
 svg+=f'<path d="M70 584H1130" stroke="#d7e0e8"/><text x="70" y="626" font-size="18" fill="#52667c">TypeScript · 零运行时依赖 · 中文交互演示</text><text x="1130" y="626" font-size="18" fill="{accent}" text-anchor="end">XuCheri / 1.0.0</text></g></svg>'
 (root/'assets'/f'{slug}-cover.svg').write_text(svg)
 (root/'assets'/f'{slug}-cover.html').write_text(f'<!doctype html><meta charset="utf-8"><title>{line1}{line2}</title><style>body{{margin:0;width:1200px;height:675px}}svg{{display:block}}</style>{svg}')
