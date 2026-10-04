# 论文

本目录用于存放 Proactive AI 论文的 LaTeX 源码，并随仓库保留 ACM `acmart` 文档类，以保证不同环境可以使用同一版本编译。

[English](README.md)

论文正文及插图的授权范围见[论文授权说明](LICENSE.md)，不自动适用仓库的软件 Apache-2.0 许可证；第三方 ACM 模板保留原有许可。

## 论文文件

- `main.tex`：正式编译与投稿所使用的英文论文源文件；
- `main_zh.tex`：与英文稿结构完整对应的中文 LaTeX 工作主稿，作者可直接在其中修改，确认后再把变化同步回英文稿；
- `references.bib`：参考文献。

当前题目是：

> Proactive AI: From Turns to Replannable Dialogue Timelines
>
> Proactive AI：从轮次到可重排的对话时间线

论文目前按非匿名 arXiv 工作预印本维护，作者为 Zijie Yang，单位为 Airalogy （Hangzhou, China）。上传前仍应最后确认作者顺序、ORCID 信息及出版元数据。

在仓库根目录编译英文稿：

```bash
pnpm paper:build
```

独立编译中文稿：

```bash
pnpm paper:build:zh
```

同时编译两份本地预览 PDF：

```bash
pnpm paper:build:all
```

图 3 不再截取通用 Demo 界面，而是由独立的论文插图页面生成。重新导出其矢量 PDF：

```bash
pnpm paper:figure
```

附图 1 复用相同的聊天组件与配色。导出四组对话示例：

```bash
pnpm paper:figure dialogue-patterns
```

示例内容集中在 `apps/demo/app/figure/dialogue-patterns/examples.ts`，消息渲染与共享样式位于 `apps/demo/app/figure/_components/`。两版论文引用同一份英文矢量图 `paper/figures/dialogue-patterns.pdf`，分别提供中英文图注。修改共享聊天样式后，应重新导出两张图并编译论文。附图采用固定宽度、内容自适应高度。导出程序等待页面内容与字体就绪，读取打印排版下的实际尺寸，再据此设置 PDF 页面；不要为了固定导出高度而删减对话或缩小字号。

该命令复用 Demo 现有的 React 应用和本机 Chrome 或 Chromium 浏览器，不需要额外安装截图工具。用于渲染插图的路由属于作者工具，不构成面向普通用户的 Demo 功能。

这些日常构建命令只更新 `paper/main.pdf` 和 `paper/main_zh.pdf`。中英文目标都会通过 `latexmk` 自动完成 LaTeX、BibTeX 和必要的重复编译，检查参考文献文件已经生成，并确认不存在未解析的正文引用或交叉引用。只运行一次 LaTeX 不足以正确加载参考文献。两种语言都会在 `tmp/latex/` 中使用隔离的源码副本，因此编辑器在源码旁生成的 `.aux`、`.bbl` 文件不会污染正式构建。

仅在准备 arXiv 上传或其他正式发布时生成稳定的对外文件名：

```bash
pnpm paper:export
```

导出命令会先重新编译中英文稿，再生成 `output/pdf/proactive-ai-from-turns-to-timelines.pdf` 和 `output/pdf/proactive-ai-from-turns-to-timelines-zh.pdf`。这两份发布 PDF 均由 Git 忽略，并可通过 LaTeX 源文件随时重新生成。

## 论文插图规范

TikZ 论文插图共同使用 `figures/figure-style.tex`。每张 TikZ 图应调用其中按照语义命名的样式，不要在单独的图中重复定义字体、颜色、线宽或消息节点。共享样式有意使用 `\sffamily`，而不写死某一种字体，使这些插图能够跟随当前论文模板变化。在现有 ACM 模板下，它会解析为 Linux Biolinum，与正文使用的 Linux Libertine 配套。图 3 与附图 1 由独立的 HTML/CSS 页面生成，共用消息组件及局部聊天样式；各页面只管理各自的布局与打印尺寸。中英文论文直接复用相同的导出图片文件。

按照最终排版尺寸，面板标题统一为 9 pt 粗体，重要标签和内容为 8.25 pt，辅助注释为 7.5 pt，紧凑头像中的文字为 7 pt 粗体。不要使用 `\tiny`，也不要为了塞入过多内容而缩小重要文字；应优先简化图或增加版面空间。数学符号继续使用 LaTeX 数学字体。保持共享的语义配色，并同时用形状、线型或符号表达含义，使图在灰度打印和色觉差异条件下仍然可读。最终插图应保持矢量格式，并检查编译后的 PDF 已经嵌入全部字体。

## ACM 模板

- 软件包：`acmart`
- 版本：2.19（2026-06-27）
- 下载日期：2026-07-31
- 正式发行来源：[CTAN](https://ctan.org/pkg/acmart)
- ACM 模板页面：[ACM Primary Article Templates](https://www.acm.org/publications/proceedings-template)
- 下载压缩包 SHA-256：`5011d4a698b993ffd4c9a6a24cf4cde7dc9deb4a7ec2dc357dbbe4ec15085618`
- 许可证：LaTeX Project Public License 1.3

上游说明明确指出，正式版本发布于 CTAN 和 ACM 网站；本仓库没有采用 GitHub 上的开发版。

论文编译时直接使用：

- `acmart.cls`
- `ACM-Reference-Format.bst`

对应的上游源码保存在 `vendor/acm/`，用于保留原始分发文件和许可证信息。不要直接修改这些第三方文件。

英文投稿稿目前使用：

```tex
\documentclass[manuscript,nonacm]{acmart}
```

当前稿件有意采用非匿名格式，以便公开提交 arXiv。`nonacm` 可以避免在预印本中出现尚未确定的 ACM 出版信息。以后若向双盲评审会议投稿，再增加 `anonymous,review`；论文录用后，删除 `nonacm`，并按照目标会议要求切换到通常使用的 `sigconf` 格式。

中文稿使用相同的非匿名作者与单位信息。英文稿仍是提交 arXiv 的权威源文件。
