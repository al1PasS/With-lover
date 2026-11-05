# 拾光设计规范

新建的双人回忆产品。暖白、豆沙粉、真实照片、局部纸张细节。UI/UX Pro Max 的首次检索误匹配 Aurora 营销页，第二次检索获得 Journal / Soft UI 方向；采用该方向的温和层次与交互规则，色彩服从项目方案，不套用营销页面结构。

- DESIGN_VARIANCE 7 / MOTION_INTENSITY 4 / VISUAL_DENSITY 4。
- React + TypeScript + Vite；Tailwind v4 + 原生语义 CSS；Radix Dialog；Phosphor 图标；首屏采用轻量 CSS 过渡，Motion 依赖为后续复杂交互预留。
- 全站语义色：bg、surface、text、muted、accent、soft、line、paper；深色模式整体切换。
- 主要强调色 #a44f60；浅色纸张和低饱和绿仅用于便签与足迹插图背景。
- 中文使用本地 PingFang SC / Microsoft YaHei。英文数字使用系统圆体，不加载外部字体服务。
- 卡片 12px、弹窗 17px、控件 8px；圆形仅用于头像和图标按钮。
- 摄影是主角，纸胶带与轻微旋转仅用于首页封面和照片抽屉。
- 手机四项底部导航，桌面顶部导航。减少动态效果时关闭入场和过渡。
- 图层：底部导航 10；弹窗遮罩 20、内容 21；反馈提示 30。
- 演示模式仅将示例编辑内容保存在当前浏览器 localStorage，登录在 sessionStorage；真实模式不把私人记录存入浏览器持久存储。正式构建 VITE_DEMO=false。

- 最近更新入口使用全站铃铛与首页封面下方的摘要卡片；桌面侧边抽屉，手机全屏面板。已读不能仅由颜色区分，未读需有标识和可访问名称。
