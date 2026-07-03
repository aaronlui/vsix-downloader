# VSIX 插件下载器

搜索 VS Code Marketplace 插件，选择版本号，生成并打开 VSIX 下载链接。

## 下载链接格式

```
https://marketplace.visualstudio.com/_apis/public/gallery/publishers/{publisher}/vsextensions/{extension}/{version}/vspackage
```

示例（Vue 官方 Volar 插件 3.3.5）：

```
https://marketplace.visualstudio.com/_apis/public/gallery/publishers/vue/vsextensions/volar/3.3.5/vspackage
```

若插件区分平台，链接会附加 `?targetPlatform=win32-x64` 等参数。

## 使用

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`，输入插件名搜索，选择版本后点击「打开下载链接」即可下载 `.vsix` 文件。

## 构建

```bash
npm run build
npm run preview
```
