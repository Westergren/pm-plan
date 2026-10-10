/**
 * 工作台客户端入口：向 Desktop 注册业务面板。
 *
 * 只做注册，不创建会话、不改写会话归属、不操作工作区。
 */

import { PlanWorkbench } from './panel.js'
import * as screens from './screens.js'
import { decorateProjects, kpis } from '../shared/metrics.js'

const React = require('react')
const { injectStyles } = require('./ui.js')

// 工作台身份：Desktop 用规范化的 GitHub owner/repo 作为工作台 id。
// 本工作台只在本机自用、不上架，这个地址只是一个稳定且不与他人冲突的身份标识，
// 安装记录与侧栏入口都用它；将来真要上架时再把它换成公开仓库即可。
const REPOSITORY = 'https://github.com/Westergren/pm-plan'

export function apply(ctx) {
  injectStyles()
  ctx.effect(() => ctx.desktopWorkbenches.register({
    title: '项目计划工作台',
    repository: REPOSITORY,
    description: '移动端多端项目的需求变更工单、工作计划、跟进事项、风险与周季报，一屏管到底。',
    panelTitle: '项目计划工作台',
    category: '项目管理',
    icon: '🗂️',
    // 业务操作优先（看板 / 表格 / 日历），所以用 customFrame：占满宿主分配的主内容区，
    // 会话按需从右侧抽屉展开，不默认占用半屏。
    customFrame: true
  }, PlanWorkbench), 'pm-plan: register workbench')
}

export const inject = ['desktopWorkbenches']

// 方便不启动 Desktop 时做渲染自测；模块加载器只读取 apply/inject。
const screensApi = { ...screens, decorateProjects, kpis }

export { PlanWorkbench, React, screensApi }
