# 拾光项目记忆

## 结构
- 前端：React 19 + TypeScript + Vite，主页面在 `frontend/src/App.tsx`，记录盒、愿望、游戏、相册在 `LittleWorld.tsx`。
- 后端：Java 21 / Spring Boot / JPA + JdbcTemplate / PostgreSQL。接口前缀 `/api/v1`。
- 数据库变化追加 Flyway 迁移，勿改已应用迁移。API 契约在 `contracts/openapi.yaml`，生成前端类型用 `npm run typegen`。
- 参考视觉规范 `design-system/MASTER.md`，暖白、豆沙粉、纸张卡片，使用现有语义色和 Phosphor 图标，兼顾手机、深色和减少动态效果。

## 双人空间与数据
- 固定两个账号。管理员管理足迹和访客可见设置；服务端执行鉴权，所有写接口要求 CSRF。
- `VITE_DEMO=false` 是真实模式，使用后端持久化；演示模式使用当前浏览器 localStorage，演示登录在 sessionStorage。两种模式不自动互相回退。
- 回忆、纪念日、足迹为独立实体；封面、相册、记录盒、愿望及共同养成为 `site_settings` JSON。
- 真实私有数据不得新增浏览器持久化。不要在文档、日志或命令输出暴露 `.env`、密码及私人正文。

## 最近更新（2026-11-05）
- V7 新增 `activity_events`、`activity_reads`；`ActivityService` 负责记录、集合差异、账号已读与游标分页。原 `audit_log` 为旧预留表，不充当动态来源。
- 内容变更与动态必须在同一事务中提交；操作者取服务端登录身份。新增模块或写入口时同步接入动态。
- 默认只看对方操作，自己的操作不增加未读。打开面板不标记已读，点击具体动态或全部已读才标记。全部已读带列表的 `latestId`，避免清掉之后的新动态。
- 批量照片一条摘要，小植物只记录升级；连续修改仅在展示层合并，原始事件与已读记录保持独立。
- 前端 `Activity.tsx` 提供全站铃铛、首页摘要和抽屉；写接口成功后触发刷新，窗口恢复和每 60 秒检查更新。按目标 ID 定位；回忆详情独立查询以覆盖列表首页外的数据。
- 只记录启用后的变化，不伪造历史操作。演示数据单独保存，不作为正式跨设备同步依据。

## 验证
- 前端：`cd frontend && npm run typegen && npm run build && npm test`。
- 浏览器：先启动 5173 的 Vite 服务，再 `cd frontend && npm run e2e`；默认使用本机 Google Chrome。
- 后端：`cd backend && ./mvnw test`。
- 数据库集成：仅在独立测试数据库中设置 `ACTIVITY_DB_TEST=true` 及 `DATABASE_URL`、`DATABASE_USER`、`DATABASE_PASSWORD` 后运行后端测试。`ActivityIntegrationTest` 使用固定的测试账号，勿连接现有用户数据库。
- 本地 Compose 服务通常位于 `http://127.0.0.1:8088`；先检查实际运行状态。部署脚本、备份说明见 README。未经任务授权不要重置数据库或覆盖用户数据。

## 维护
项目状态变化时更新本文件或 README；具体实现以代码为准。不要把临时测试日志、凭据或未经验证的推测写入记忆。

## 个人信息维护（2026-11-05）
- `/admin` 的 `ProfileSettings.tsx` 提供当前账号昵称、用户名和密码维护，接口为 `GET/PATCH /api/v1/account/profile`。
- 服务端按登录身份锁定当前账号；昵称可独立保存。用户名或密码变化必须验证旧密码；新密码 8–200 位，使用现有 Argon2 编码。旧密码校验有账号频率限制，响应不返回密码或哈希。
- 用户名 3–40 位字母、数字、下划线且唯一。V8 将动态已读外键改为 ON UPDATE CASCADE，同时迁移历史作者关联，保留账号 ID 和内容。
- 仅凭据变化才删除该账号所有 Spring Session 会话并销毁当前会话，前端清理 CSRF、提示重新登录并预填用户名。昵称变化继续保持登录。密码变化不写动态；昵称变化只写昵称摘要。
- `ProfileIntegrationTest` 在独立 PostgreSQL 中验证旧密码、重名、账号隔离、改名关联保留、真实双会话退出，以及旧密码登录失败/新密码登录成功。
- 个人界面浏览器测试：另起 `VITE_DEMO=false npm run dev -- --host 127.0.0.1 --port 5174`，运行 `PROFILE_REAL_UI_TEST=true npx playwright test profile.spec.ts`。测试使用合成 API 响应；默认浏览器测试跳过这组，避免将演示登录误当真实密码验证。

## 背景音乐（2026-11-10）
- `Music.tsx` / `musicState.ts` 提供全局播放器与双方可见的管理面板。曲库和全站选曲由后端共享；开关仅当前页面会话有效、默认开启，自动播放受阻需点击。实际播放才旋转图标，关闭显示斜杠；路由切换不重建音频。
- V9 新增 `music_tracks` / 单行 `music_state`。接口为 `GET /api/v1/music`、上传/删除 `/music/tracks`、`PUT /music/selection` 和鉴权 `/music/tracks/{id}/content`。全体成员可管理；无公开音乐接口，写接口要求 CSRF。快照 revision 单调增加，页面可见时每 15 秒同步，换歌保留各自开关。
- MP3 Layer III / 标准 PCM WAV，最大 20 MiB/首、20 首、200 MiB；服务端校验实际结构。音频位于 `MEDIA_ROOT/music`，随机文件名、私有流式 Range 读取，不写 base64 设置或浏览器持久化。Compose 配置 `/app/media`，本地默认 `./media`。
- 曲库写操作、选曲及动态在相同事务内，统一锁定单行状态；上传回滚清理，删除提交后清理，音乐专属目录宽限期孤儿清理。不得把媒体目录直接公开，也不得以清理音乐为由处理其他文件。
- 演示音乐只在当前页面内存保存，刷新/退出即清空。真实浏览器测试 `MUSIC_REAL_TEST=true npx playwright test music-real.spec.ts` 仅指向独立 5174/API/测试数据库，使用合成账号与音频，不能指向已有双人空间。媒体必须与数据库做配套备份，现有 `scripts/backup.sh` 单独只备份数据库。
