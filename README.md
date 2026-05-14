# 当当日记

新生儿睡眠、吃奶、便便、尿泡和体重记录 PWA。睡觉和吃奶支持开始/结束记录并计算持续时间，便便和尿泡一键记录当前时间，宝宝体重和妈妈体重以千克记录并自动纳入当前日期。数据会先保存在本机 IndexedDB；配置 Supabase 后可登录并在不同设备间同步，同时保留每日时间轴、喂奶间隔曲线、近 7 天睡眠统计、宝宝/妈妈体重趋势，以及 JSON/CSV 导出。

## 技术栈

- Vite + React + TypeScript
- Dexie / IndexedDB 本机存储
- Supabase Auth + Postgres 云同步
- Recharts 图表
- vite-plugin-pwa 离线缓存与安装配置

## Supabase 云同步

1. 在 Supabase 项目 SQL Editor 执行 `supabase-schema.sql`。
   已有项目升级到宝宝/妈妈体重版本时，也需要重新执行一次该 SQL，以增加 `weight_owner` 字段并刷新 Supabase REST schema cache。
2. 复制 `.env.example` 为 `.env.local`，填入项目的 URL 和 publishable/anon key：

```env
VITE_SUPABASE_URL=你的 Project URL
VITE_SUPABASE_PUBLISHABLE_KEY=你的 publishable key
```

3. 本地重新启动 `npm run dev`。部署到 Vercel 时，在 Project Settings 的 Environment Variables 里添加同名变量。

第一版同步使用单家庭账号：全家设备登录同一个邮箱账号即可共享记录。离线时仍会写入本机，回到前台、恢复网络、手动同步或新增记录后会补同步。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5173/`。

## 构建检查

```bash
npm run lint
npm run build
```

## iPhone 使用

部署后用 iPhone Safari 打开网址，点分享按钮，选择“添加到主屏幕”。之后可以从主屏幕像 App 一样打开使用。

## 数据备份

即使开启云同步，也建议定期在“数据”页导出 JSON 备份；CSV 适合发给家人或医生查看。
