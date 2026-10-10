/**
 * 示例数据：第一次进入且数据为空时生成，方便立刻看到所有看板。
 * 所有条目都带「示例」标签，随时可以在侧栏一键清空。
 */

import { createId } from './model.js'
import { addDays, todayISO } from './date.js'

const SEED = '示例'

export function sampleState(today = todayISO()) {
  const project = (module, name, platform, status, owner, startOffset, dueOffset, progress, summary, tags) => {
    const startedOn = startOffset === null ? '' : addDays(today, startOffset)
    const dueDate = dueOffset === null ? '' : addDays(today, dueOffset)
    return {
      id: createId('prj'),
      name,
      module,
      platform,
      status,
      owner,
      startedOn,
      dueDate,
      progress,
      link: '',
      summary,
      tags: [SEED, ...tags],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }

  const projects = [
    project('移动端开发', '手机银行 6.2 版本迭代', '移动手机', '进行中', '我', -24, 9, 62,
      '本期含转账限额调整、消息中心改版和指纹登录优化，需与后端接口联调后统一提测。', ['版本迭代', '手机端']),
    project('移动端开发', '移动展业 PAD 端客户建档重构', '移动 PAD', '阻塞', '我', -32, 5, 45,
      '表单引擎重写，等业务确认字段校验规则；未确认前测试用例写不下去。', ['PAD', '阻塞']),
    project('移动端开发', '微信小程序开户流程优化', '小程序', '进行中', '我', -12, 16, 35,
      '开户转化率偏低，本期做三步合一并补充失败重试引导。', ['小程序', '转化率']),
    project('移动端开发', '小程序端埋点补全与看板', '小程序', '待启动', '我', null, 30, 0,
      '补齐关键路径埋点，输出转化漏斗看板，为下季度运营提供数据。', ['数据', '待启动']),
    project('公司项目', '信贷平台移动端需求池梳理', '移动手机', '进行中', '我', -8, 12, 50,
      '汇总各分行反馈，形成下一批迭代需求清单并完成优先级评审。', ['需求池']),
    project('日常工作', '移动端周例会与风险同步', '其他', '进行中', '我', -40, 20, 70,
      '每周例会纪要、阻塞项升级与跨端联调协调。', ['例会', '日常']),
    project('日常工作', '移动端测试环境巡检', '其他', '进行中', '我', -20, 2, 80,
      '每周巡检三端测试环境可用性与版本一致性。', ['环境', '日常']),
    project('其他项目', '移动端组件库文档整理', '其他', '进行中', '我', -15, 25, 30,
      '把散落的组件说明收进一份可检索的文档，减少重复沟通。', ['文档', '组件库']),
    project('其他项目', '上季度移动端质量复盘', '其他', '已完成', '我', -70, -6, 100,
      '缺陷分布、回归成本与改进项复盘，已归档。', ['复盘', '已完成'])
  ]

  const byName = new Map(projects.map((item) => [item.name, item.id]))
  const orders = []
  const plans = []
  const logs = []

  const order = (projectName, title, kind, priority, stage, owner, targetOffset, estDays, dueOffset, description) => {
    const id = createId('ord')
    orders.push({
      id,
      projectId: byName.get(projectName) || '',
      title,
      kind,
      priority,
      stage,
      owner,
      target: '',
      estDays,
      dueDate: dueOffset === null ? '' : addDays(today, dueOffset),
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    return id
  }

  const plan = (projectName, orderId, title, owner, status, startOffset, dueOffset, progress, note) => {
    const id = createId('pln')
    plans.push({
      id,
      projectId: byName.get(projectName) || '',
      orderId,
      title,
      owner,
      status,
      startedOn: startOffset === null ? '' : addDays(today, startOffset),
      dueDate: dueOffset === null ? '' : addDays(today, dueOffset),
      progress,
      note,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    return id
  }

  const log = (refType, refId, kind, text, offset) => {
    logs.push({
      id: createId('log'),
      refType,
      refId,
      at: new Date(Date.now() + offset * 86400000).toISOString(),
      kind,
      text
    })
  }

  const o1 = order('手机银行 6.2 版本迭代', '转账限额调整（含人脸复核）', '迭代需求', '高', '开发中', '我', 4, 5, 3,
    '限额规则由单笔 50 万调整为分级限额，超限走人脸复核。')
  const o2 = order('手机银行 6.2 版本迭代', '消息中心改版', '迭代需求', '中', '联调中', '我', 3, 4, 4,
    '分类聚合、已读同步，与服务端推送协议对齐。')
  const o3 = order('手机银行 6.2 版本迭代', '指纹登录偶发失败修复', '缺陷', '紧急', '测试中', '我', 2, 2, -1,
    '部分安卓机型指纹回调丢失，需要在测试环境复现并加兜底。')
  const o4 = order('移动展业 PAD 端客户建档重构', '建档字段校验规则变更', '变更需求', '高', '待评审', '我', 3, 8, -2,
    '业务新增 12 个必填校验项，需确认是否影响存量客户补录。')
  const o5 = order('移动展业 PAD 端客户建档重构', '表单引擎性能优化', '技术任务', '中', '开发中', '我', 6, 6, 6,
    '百字段表单渲染卡顿，改为分段渲染。')
  const o6 = order('微信小程序开户流程优化', '开户三步合一改造', '迭代需求', '高', '开发中', '我', 10, 12, 14,
    '身份认证、绑卡、风险测评合并到一个引导流。')
  const o7 = order('微信小程序开户流程优化', '失败重试引导文案', '迭代需求', '低', '待排期', '我', 12, 3, 18,
    '失败后给明确下一步，减少重复提交。')
  const o8 = order('信贷平台移动端需求池梳理', '三季度需求池评审', '技术任务', '中', '待评审', '我', 5, 3, 5,
    '汇总分行反馈，产出优先级清单。')

  const p1 = plan('手机银行 6.2 版本迭代', o1, '与后端确认限额分级口径', '我', '进行中', -3, 1, 60, '输出接口字段对照表。')
  const p2 = plan('手机银行 6.2 版本迭代', o3, '安卓指纹失败机型复现', '我', '进行中', -1, 0, 40, '覆盖 5 个主流机型。')
  const p3 = plan('手机银行 6.2 版本迭代', o2, '整理 6.2 提测清单', '我', '未开始', 1, 4, 0, '含回归范围与冒烟用例。')
  const p4 = plan('移动展业 PAD 端客户建档重构', o4, '推动业务确认校验规则', '我', '进行中', -5, -2, 50, '已发两轮确认邮件，等待回复。')
  const p5 = plan('移动展业 PAD 端客户建档重构', o5, '百字段表单性能基线测试', '我', '未开始', 3, 6, 0, '先建立基线数据。')
  const p6 = plan('微信小程序开户流程优化', o6, '联调开户主流程', '我', '进行中', -2, 3, 45, '重点验证异常分支。')
  const p7 = plan('微信小程序开户流程优化', null, '整理小程序上线检查项', '我', '未开始', 8, 12, 0, '版本号、灰度开关、回滚方案。')
  const p8 = plan('小程序端埋点补全与看板', null, '梳理关键路径埋点清单', '我', '未开始', null, null, 0, '未排期，等排期会确认。')
  const p9 = plan('日常工作', null, '本周移动端风险同步邮件', '我', '未开始', 0, 2, 0, '把阻塞项升级给项目经理。')
  const p10 = plan('日常工作', null, '测试环境巡检（三端）', '我', '进行中', -1, 0, 70, '记录版本一致性结果。')
  const p11 = plan('其他项目', null, '组件库文档目录搭建', '我', '进行中', -6, 9, 35, '先定目录结构。')

  log('project', projects[0].id, '进展', '6.2 需求评审通过，进入开发阶段。', -20)
  log('project', projects[0].id, '进展', '限额规则初版接口联调完成。', -6)
  log('order', o3, '阻塞', '测试环境暂缺指定机型，阻塞复现。', -3)
  log('project', projects[1].id, '阻塞', '业务侧校验规则未确认，测试用例无法定稿。', -4)
  log('order', o4, '变更', '业务追加 12 个必填校验项。', -2)
  log('project', projects[2].id, '进展', '开户主流程联调完成 60%。', -1)
  log('project', projects[8].id, '决策', '复盘结论：回归阶段引入自动化冒烟。', -6)
  log('plan', p4, '阻塞', '等待业务回复规则确认。', -2)

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    seededAt: new Date().toISOString(),
    projects,
    orders,
    plans,
    logs
  }
}

/** 空数据判定：四个集合都为空才认为需要生成示例。 */
export function isEmptyState(state) {
  if (!state || typeof state !== 'object') return true
  const size = (value) => (Array.isArray(value) ? value.length : 0)
  return size(state.projects) + size(state.orders) + size(state.plans) + size(state.logs) === 0
}
