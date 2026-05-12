# 当当日记

新生儿睡眠、吃奶、便便和尿泡时间记录 PWA。睡觉和吃奶支持开始/结束记录并计算持续时间，便便和尿泡一键记录当前时间。数据保存在本机 IndexedDB，并提供每日时间轴、喂奶间隔曲线、近 7 天睡眠统计，以及 JSON/CSV 导出。

## 技术栈

- Vite + React + TypeScript
- Dexie / IndexedDB 本机存储
- Recharts 图表
- vite-plugin-pwa 离线缓存与安装配置

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

记录只保存在当前浏览器本机。建议定期在“数据”页导出 JSON 备份；CSV 适合发给家人或医生查看。
