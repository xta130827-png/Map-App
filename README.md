# 成都地图笔记

两人共用的地图笔记应用：在百度地图上标记健身房，给任意地点写笔记。

- 前端：`public/`（纯 HTML/JS，无需构建，可「添加到主屏幕」作为 iPhone App 使用）
- 后端：`functions/api/[[path]].js`（Cloudflare Pages Functions）
- 数据库：Cloudflare D1（`schema.sql`）

## 一、准备

1. 安装 Node.js LTS：https://nodejs.org
2. 注册 Cloudflare 账号：https://dash.cloudflare.com
3. 百度地图 AK：https://lbsyun.baidu.com → 控制台 → 创建应用，类型选「浏览器端」，Referer 白名单先填 `*`，部署完成后改成你的域名。新建 `public/config.local.js`（不会提交到 git），内容为 `window.APP_CONFIG.BAIDU_AK = '你的AK';`。部署时这个文件会一起上传。

## 二、部署（在本目录打开终端）

```bash
npx wrangler login
npx wrangler d1 create chengdu-map-notes        # 把输出的 database_id 填进 wrangler.toml
npx wrangler d1 execute chengdu-map-notes --remote --file=schema.sql
npx wrangler pages project create chengdu-map-notes --production-branch=main
npx wrangler pages secret put APP_PASSWORD --project-name=chengdu-map-notes   # 设置两人共用的口令
npx wrangler pages deploy
```

部署完成后会得到 `https://chengdu-map-notes.pages.dev`。

## 三、国内访问更稳定：绑定自己的域名（推荐）

`*.pages.dev` 在国内经常打不开。买一个便宜域名（.top / .xyz 等，约 10–30 元/年，服务器在海外，不需要备案），
然后在 Cloudflare 控制台 → Workers & Pages → 本项目 → 自定义域 中添加。最后把这个域名加到百度 AK 的 Referer 白名单。

## 四、装到 iPhone

用 Safari 打开网址 → 分享按钮 → 「添加到主屏幕」。首次打开时输入你的名字和共享口令。

## 本地调试

```bash
npx wrangler d1 execute chengdu-map-notes --local --file=schema.sql
echo APP_PASSWORD=test > .dev.vars
npx wrangler pages dev
```

## 以后更新

修改代码后重新运行 `npx wrangler pages deploy`。
