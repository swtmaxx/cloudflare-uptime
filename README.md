# Cloudflare Uptime

一个从零设计的 Cloudflare Worker + D1 可用性监控系统。

它使用 Worker 本地探测、Check-Host 和 Globalping 进行单点或多地区探测，后台和公开状态页都由同一个 Worker 提供。

## 当前能力

- Worker 直接执行 HTTP/HTTPS 和 TCP 端口检查
- Worker HTTP 支持方法、请求头、请求体、成功状态码、响应关键字和超时
- HTTP 监控可按监控选择 Worker、Check-Host 或 Globalping
- Check-Host 支持固定节点；Globalping 支持国家/城市位置规则
- Globalping HTTP 支持 GET、HEAD、OPTIONS、POST、PUT、PATCH、DELETE 的基础方法配置
- 多数节点失败才判定为宕机
- 每分钟 Cron 检查
- 管理员登录、监控管理、节点缓存和历史记录
- 根路径入口可在仪表盘和已发布状态页之间选择，管理后台位于 `/admin`
- 公开状态页
- PushPlus 通知配置、监控绑定、测试通知和状态变化提醒

通知只保存当前发送状态，不建立单独的故障事件历史。PushPlus Token 和 Globalping Token 由后台写入 D1，管理接口只返回是否已配置，不返回明文 Token。

Check-Host 的公开接口不支持自定义请求头、Bearer Token、POST 请求体或响应内容断言。Globalping 在本版本中实现基础 HTTP 方法和多地区位置检查；需要 API 请求头、请求体或响应断言时使用 Worker 探测。

## 本地运行

```powershell
npm install
npx wrangler d1 migrations apply DB --local
npm run dev
```

打开 Wrangler 输出的地址。首次访问会进入管理员初始化页面。

部署后的根路径默认进入公开状态页首页，展示全部已启用监控；可在系统设置中切换到后台或已发布状态页。管理员控制台访问 `/admin`，命名状态页仍使用 `/status/<slug>`。

## 部署

1. 创建 D1 数据库：

```powershell
npx wrangler d1 create cloudflare-uptime-db
```

2. 将命令输出的数据库 ID 写入 `wrangler.jsonc` 的 `database_id`。首次部署后，管理员用户名和密码在初始化页面设置，运行时不需要配置业务环境变量。

3. 应用远程迁移并部署：

```powershell
npx wrangler d1 migrations apply cloudflare-uptime-db --remote
npm run deploy
```

也可以使用 `.github/workflows/deploy.yml`。GitHub Actions 只需要 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 两个仓库 Secret；工作流会自动查找或创建 D1、执行迁移、构建并部署 Worker。
首次成功部署后，工作流会把实际 D1 ID 回写到 `wrangler.jsonc`，避免其他部署方式继续使用占位 ID。

## 运行参数

首次初始化后，系统设置页面中的默认值为：

- 监控上限：50
- 每个监控节点上限：5
- 每轮调度任务上限：20
- 历史记录保留：30 天

PushPlus 通知在后台“通知设置”中配置。每个监控可以单独选择通知配置，并设置部分异常、宕机、恢复事件和连续异常次数；默认连续异常 3 次后通知。Globalping Token 在系统设置中配置。

Check-Host 没有在公开文档中承诺固定免费调用额度。生产环境应根据实际返回的限流情况调整这些参数。

Globalping 当前公开 API 配额由其服务端控制；未认证请求和认证请求的额度不同，超出额度会在后台记录为 provider 错误，不会直接判定监控目标宕机。
