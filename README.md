# 拾光 · Couple Memory

按照《情侣日常记录网站方案》搭建的独立项目。参考项目 MBG 与 SharedMoments 保持原样，未复制其后端或匿名读写配置。

当前交付是可自托管的双人私有 MVP：包含交互前端、Java API、PostgreSQL 持久化、自动 HTTPS、健康检查与备份入口。图片私有对象存储、异地备份自动化和大规模压力验收仍属于后续生产加固范围。

## 现在可以体验什么

- 首页：双人昵称、在一起天数、手账封面、最近回忆、纪念日、足迹入口。
- 时光：关键词和标签筛选（同步地址栏）、回忆详情、上一篇/下一篇。
- 相册：照片网格、大图阅读；足迹：城市筛选及关联故事列表。
- 示例编辑：新建、编辑、草稿、私密/公开摘要、删除和恢复、添加纪念日。
- 桌面/手机适配、手机四项底部导航、系统深色模式与手动切换、减少动态效果支持。

示例中的人物、照片和故事不是用户真实数据。示例模式使用浏览器 `localStorage` 保存编辑结果，不会向 API 提交；登录状态只保留在当前标签会话。点击“进入我们的小世界”即可进入示例编辑，无需真实密码。未登录页面不会渲染记录盒、愿望、游戏或相册中的虚拟私密内容。

## 本地启动前端

需要 Node.js 24（开发验证版本 24.11.1）。

```sh
cd frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

访问 http://127.0.0.1:5173 。默认是演示模式。接口联调时创建 `frontend/.env.local`：

```dotenv
VITE_DEMO=false
```

Vite 将 `/api` 转发至 `localhost:8080`，真实模式不会因为 API 故障而退回演示登录。真实数据不存入 localStorage、IndexedDB 或 Service Worker。

`VITE_DEMO` 是编译时模式开关：不设置或设为 `true` 时只使用浏览器演示数据；设为 `false` 时调用 Spring Boot API，并由 PostgreSQL 持久化。正式 Docker 镜像已经固定使用 `VITE_DEMO=false`。

## 后端与数据库

Java 21，Spring Boot 3.5.16，Spring Security、Spring Session JDBC、Argon2id、JPA、Flyway、PostgreSQL。

已实现：

- 匿名会话检测、CSRF 获取、双人登录、服务端会话轮换、退出与会话销毁。
- IP 与账户登录尝试限制；无注册及第三账户创建接口，数据库只允许账户 ID 1、2。
- 回忆公开白名单 DTO、私有列表、创建、修改、软删除、恢复；公开查询排除草稿与回收站。
- 独立公开摘要必填校验；版本冲突返回 409；纪念日查询与创建。
- 管理员访客可见设置：整站完全私密，或按首页、时光、纪念日、相册、足迹分别开放。公开接口在服务端再次校验，不能通过直接请求绕过前端。
- Flyway 建表包含用户、会话、回忆、纪念日，以及后续媒体、相册、地点关联、任务和审计表。

注意：当前公开设置会公开所填标题、完整日期、城市和摘要。方案中的**独立公开标题、日期精度选择与逐张照片授权**仍需实现后再作正式隐私验收。

```sh
cp .env.example .env
# 编辑 .env，设置随机 DATABASE_PASSWORD。
# 仅本机 HTTP 联调时将 COOKIE_SECURE 设为 false。
docker compose up -d database
```

## 正式部署

推荐部署到一台安装了 Docker Engine 与 Docker Compose v2 的 Linux 服务器。生产链路为：

```text
互联网 → Caddy（自动 HTTPS）→ Nginx（前端与 /api 反向代理）→ Spring Boot → PostgreSQL
```

部署前需要：

- 一个已经解析到服务器公网 IP 的域名；
- 防火墙放行 TCP 80、TCP 443 和 UDP 443；
- 至少 2 GB 内存；
- 不要将 `.env`、数据库备份或真实照片提交到 Git。

首次部署：

```sh
cp .env.example .env
# 编辑 .env：填写至少 24 位随机 DATABASE_PASSWORD 和真实 DOMAIN。
# COOKIE_SECURE 在正式环境必须保持 true。
./scripts/deploy.sh
./scripts/init-accounts.sh
```

账户初始化会在终端中依次要求填写两位用户的用户名、昵称与密码。第一个账户拥有管理员角色，第二个账户为普通成员；初始化只允许执行一次，不会覆盖已有账户。

查看服务状态和日志：

```sh
docker compose -f compose.yaml -f compose.prod.yaml ps
docker compose -f compose.yaml -f compose.prod.yaml logs -f --tail=200
```

更新部署：

```sh
git pull --ff-only
./scripts/backup.sh
./scripts/deploy.sh
```

`deploy.sh` 会拒绝示例密码、少于 24 位的数据库密码、示例域名及不安全 Cookie 配置。正式镜像固定以 `VITE_DEMO=false` 构建，编辑内容会进入 PostgreSQL，不会在退出后恢复成示例数据。

### 备份

手动创建 PostgreSQL 自定义格式备份：

```sh
./scripts/backup.sh
```

备份默认写入项目下的 `backups/`，权限为仅当前用户可读。也可通过 `BACKUP_DIR=/安全挂载目录 ./scripts/backup.sh` 保存到独立磁盘。生产环境应再配置定时任务，并将备份同步到服务器之外；只有本机副本不算完整备份。

恢复前应先停止写入并再次确认目标数据库。恢复属于覆盖性操作，不由自动部署脚本执行：

```sh
docker compose exec -T database pg_restore \
  -U shiguang -d shiguang --clean --if-exists < backups/备份文件.dump
```

### 上线检查

- `https://你的域名/healthz` 返回 `ok`；
- 浏览器地址栏证书有效，HTTP 会自动跳转 HTTPS；
- 登录后新增一条测试回忆，退出并重新登录仍然存在；
- 重启容器后数据仍然存在；
- `docker compose ... ps` 中 database、api、web、gateway 均为健康状态；
- 在另一台设备上验证最近一次数据库备份可以恢复。

### 本地全栈联调

数据库默认不映射宿主机端口。以下命令启动不含公网 HTTPS 网关的基础服务，Web 入口仅绑定 `http://127.0.0.1:8088`：

```sh
docker compose up --build -d
./scripts/init-accounts.sh
```

初始化时交互输入两组用户名、昵称和密码；第一个账户为管理员，第二个为成员。重复初始化拒绝覆盖；密码不写入代码、命令参数或日志。

基础 Compose 与正式 Compose 都会以 `VITE_DEMO=false` 构建前端。正式部署额外启用 Caddy 自动签发 TLS 证书和 Secure Cookie。当前 Flyway 迁移随 API 启动运行；多实例或零停机部署前，应再拆成独立的一次性迁移任务。

### 媒体文件目录安全

Compose 已将独立 `media` 卷挂载到 API 容器的 `/app/media`，但当前没有把这个目录直接暴露给 Nginx 或公网。后续迁移照片和音频时，应继续由后端使用随机文件名保存，并通过鉴权下载接口读取；同时校验文件头、限制类型和大小、清理 EXIF、禁止脚本执行，并在响应中固定安全的 `Content-Type` 与 `Content-Disposition`。不要把上传目录映射成可执行的静态网站目录。

不使用 Docker 时，在环境中设置 DATABASE_URL、DATABASE_USER、DATABASE_PASSWORD、COOKIE_SECURE，再执行：

```sh
cd backend
./mvnw test
./mvnw spring-boot:run
```

## 工程结构

- `frontend/src`：React 页面、语义样式、共享类型、API 客户端、日期规则。
- `backend/src/main/java/cn/shiguang`：安全配置、认证、回忆服务、纪念日、初始化命令。
- `backend/src/main/resources/db/migration`：数据库与会话表迁移。
- `contracts/openapi.yaml`：已实现 API 契约；`frontend/src/api/schema.d.ts` 为生成类型。
- `e2e`：浏览器验收、桌面/手机/深色截图与 Lighthouse 报告。
- `design-system/MASTER.md`：视觉设计决策与语义令牌约定。
- `compose.yaml`、`compose.prod.yaml`、Dockerfile、Nginx、Caddy：本地与正式环境部署配置。

## 验证命令

```sh
cd frontend
npm run typegen
npm run build
npm test
npm run e2e  # 先在 5173 启动 dev 服务
```

Playwright 默认使用 macOS 已安装的 Google Chrome，可通过 `PLAYWRIGHT_CHROME` 指定其他 Chromium 路径。Java 测试：`cd backend && ./mvnw test`。

已加入日期边界测试、公开字段隔离测试、版本冲突测试、CSRF 与匿名权限测试，以及浏览器完整编辑/删除/恢复流程。数据库迁移、持久会话和事务的真实 PostgreSQL 集成验收尚未完成；当前机器未运行 Docker daemon。

## 下一阶段明确待办

1. 图片上传、实际格式校验、私有存储鉴权、独立 worker、HEIC 转换、EXIF 清理、重试与清理任务。当前表单不提供假上传。
2. 可选的地图 SDK、受限代理和地点搜索选点；目前足迹页可独立记录地点，地图图层可在需要时再接入。
3. 持久相册管理、照片排序、纪念日编辑/删除/置顶/公开配置、网站设置与真实双人资料。
4. 回忆详情独立路由、服务端关键词/标签筛选、游标分页与前端加载更多。当前 API 用固定 24 条页，前端仅加载首页数据。
5. 公开标题与日期精度、逐张照片公开版本授权；账户改密与全会话撤销；写操作审计。
6. 回收站 30 天清理、加密异地备份自动化和恢复演练、独立迁移任务、容器镜像与媒体样本验收。
7. PostgreSQL/Testcontainers 集成验收、千条回忆与五千张照片压力/权限测试。

上述能力尚未冒充已完成。当前版本适合两位固定用户、小流量、访问受控的私有 MVP；若要开放注册、公开分享大量真实照片或扩展为多用户服务，应先完成以上隐私、媒体与容量加固。

## 本次验证结果

- TypeScript 检查与 Vite 生产构建通过；Java 服务打包通过。
- Vitest：9 项通过；JUnit：14 项通过；Playwright：5 条验收用例通过（含 375px、横屏、平板、桌面及访客权限流程）。
- npm audit：0 项已知漏洞（当前锁文件）。
- Lighthouse 正式构建、模拟移动设备：性能 94，可访问性 100，最佳实践 100；LCP 3.0 秒，CLS 0，TBT 0ms。当前 LCP 尚未达到方案 2.5 秒目标，仍需部署网络环境优化和复测。
- 原始报告在 `e2e/lighthouse-production.json`。开发服务器报告不用于性能验收。

## 双人资料与日期

双人昵称及用户提供的日期统一放在 `frontend/src/profile.ts`：杰杰、雯晴；第一次聊天 2026-05-13，第一次见面 2026-06-19，确认关系 2026-09-12。首页累计天数从确认关系当天的 0 天开始。未推断两人的出生年份。

雯晴生日按农历七月初八；杰杰的公历 1 月 30 日与农历腊月廿八分别保留。农历下一次日期通过浏览器 Intl 中国历、北京时间计算，遇到闰月只纪念常规月份。此处为当前预览的个人资料配置，尚未写入真实数据库；真实模式纪念日仍来自后端。

首页大封面可由登录用户替换；最近回忆随可见记录列表更新。正式环境的封面和小型共享模块写入数据库设置，相册与语音的大文件存储仍需迁移到独立媒体目录。
