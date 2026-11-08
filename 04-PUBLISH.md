# 04 · 发布

> 发布是所有环节里最容易出事故的地方：会删错作品、会重复发布、会把封面弄丢。
> 这一份的规则都是事故换来的，别省。

## 一、为什么走 CDP，不走 AppleScript

| AppleScript 的坑 | 后果 |
|---|---|
| `front window` 指向不确定 | 看错标签页，操作到别的账号 |
| 设置上传文件必须弹系统对话框 | 无法自动化 |
| `element.click()` 没有用户激活 | Chrome 直接忽略 |

CDP（Chrome DevTools Protocol）能 `DOM.setFileInputFiles` 设置文件、`Runtime.evaluate` 读 DOM、`Page.captureScreenshot` 截图、`Input.dispatchMouseEvent` 发真鼠标。

## 二、环境：必须用独立的浏览器实例

**红线：绝不用你日常用的 Chrome 起 CDP。** 一旦占用，你点 Chrome 图标看到的是空白浏览器（没书签、没登录态），会以为数据丢了。

```bash
# 1. 复制一份 Chrome，改成独立 App（只做一次）
mkdir -p ~/agent-browser
cp -R "/Applications/Google Chrome.app" ~/agent-browser/Chrome-Agent.app
cd ~/agent-browser/Chrome-Agent.app/Contents
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.google.Chrome.agent" Info.plist
/usr/libexec/PlistBuddy -c "Set :CFBundleName Chrome Agent" Info.plist
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Chrome Agent" Info.plist
cd ~/agent-browser && xattr -cr Chrome-Agent.app && codesign --force --deep --sign - Chrome-Agent.app

# 2. 启动（脚本里 DATA_DIR / PROFILE 按自己的改）
cd publish && ./start-cdp.sh

# 3. 第一次：在弹出的窗口里手动登录四个平台，之后登录态留在 profile 里
# 4. 用完关掉
./stop-cdp.sh
```

> Chrome 136+ 不允许在默认配置目录上开 `--remote-debugging-port`，所以必须指定 `--user-data-dir`。这也是为什么要有独立 profile。

## 三、发布流程（每条都别跳）

```bash
# ① 预检：文件存在、有音视频流、标题字数、首帧与封面一致、标题在安全区
node preflight.js --platform douyin --video ../final.mp4 --title "标题" \
  --firstFrameCover ../covers/9x16.jpg --titleTop 0.30 --titleBottom 0.52

# ② dry-run：只填表，不发布。看着表填对了再继续
node publish.js --platform douyin \
  --video ../final.mp4 --cover ../covers/3x4.jpg --coverH ../covers/4x3.jpg \
  --title "标题≤30字" --desc "正文 #话题"

# ③ 确认后发布（加 --publish）
node publish.js --platform douyin --video ../final.mp4 ... --publish

# ④ 自动回查：导航到列表 → 刷新 → 按标题前 8 字找作品 → 截图存 evidence/
```

四个脚本：

| 脚本 | 平台 | 参数 |
|---|---|---|
| `publish.js --platform douyin` | 抖音 | video/cover/coverH/title/desc |
| `publish.js --platform xhs` | 小红书 | video/cover/title/desc（封面只能首帧，见下） |
| `publish-channels.js` | 视频号 | video/cover/desc/short（短标题 ≤16 字） |
| `publish-bili.js` | B站 | video/cover/cover169/title/desc |

## 四、四平台差异（记住这张表，少返工一半）

| 项 | 抖音 | 小红书 | 视频号 | B站 |
|---|---|---|---|---|
| 标题上限 | 30 | **20** | 短标题 **16** | 80 |
| 正文 | 1000 | 1000 | 1000 | 2000 |
| 封面 | 竖 3:4 + 横 4:3 | **网页版不能传，只能首帧/智能推荐** | 3:4，可上传 | 4:3 + 16:9 |
| 上传完成信号 | 「上传完成」 | 「检测为高清」 | 出现「删除」按钮 | 「上传完成」 |
| 特殊坑 | 常驻"如作品还在上传中"不是状态 | 发布按钮是 `<xhs-publish-btn>`，只能按坐标 | WUJIE 微前端，表单在 Shadow DOM | 创作声明要单独选 |

### 视频号的 Shadow DOM 怎么破

`DOM.setFileInputFiles` 在 Shadow DOM 里无效。有效解法是**页面内造 File**：

```js
// 分块注入 base64（每块 8MB，别一次塞几百 MB）
window.__b64 += "<chunk>";

var b = atob(window.__b64), arr = new Uint8Array(b.length);
for (var i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
var file = new File([arr], "视频.mp4", { type: "video/mp4" });
var dt = new DataTransfer(); dt.items.add(file);
input.files = dt.files;                                  // JS 可以写 files
input.dispatchEvent(new Event("change", { bubbles: true }));
```

任何"文件传不上去"的平台都可以用这招。注意单次 base64 字符串超过约 512MB 会爆 V8，必须分块。

### 小红书封面

网页版**不给自定义封面**。两个选择：
1. 手机端发布补封面；
2. 用首帧兜底（推荐，见下）。

## 五、首帧兜底（最重要的一条）

把封面做成视频前 0.6 秒，所有平台抓首帧时自动就是设计稿：

```bash
ffmpeg -loop 1 -t 0.6 -i cover-9x16.jpg -i final.mp4 \
  -filter_complex "[0:v]scale=1080:1920,setsar=1,trim=duration=0.6,setpts=PTS-STARTPTS[a];[1:v]setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0[v];[1:a]adelay=600|600,apad=pad_dur=0.6[aud]" \
  -map "[v]" -map "[aud]" -c:v libx264 -crf 18 -c:a aac final-with-cover.mp4
```

好处：视频号丢封面、小红书不能传、B站裁切，三个问题一起解决。代价是开头 0.6 秒静帧——行业常规做法。

## 六、发布后回查（脚本已内置，但要知道它在验什么）

1. 导航到内容管理列表
2. **强制刷新**（防缓存）
3. 按标题前 8 个字找作品
4. 截图存 `evidence/时间戳-平台.png`
5. 人眼看截图：标题、时长、封面、可见范围

**没截图等于没发。** 报告里要有图。

## 七、红线

| # | 不许 | 为什么 |
|---|---|---|
| 1 | 用日常 Chrome 起 CDP | 用户以为数据丢了（真实发生过） |
| 2 | 按坐标猜「删除」按钮 | 删过错作品 |
| 3 | 固定 `sleep` 后点发布 | 上传没完，作品丢失 |
| 4 | 一次同时操作两个平台 | 状态串台 |
| 5 | 封面靠平台接口 | 视频号会丢、小红书没有、B站会裁 |
| 6 | 没授权就发布/删除/改可见范围 | 不可逆 |

## 八、失败记录模板（失败时写这一段，别口头说"没成功"）

```
时间：
平台：
操作：上传 / 发布 / 改封面 / 删除
目标作品：（ID + 标题，删除类必填）
现象：（具体，如"点在发布后 URL 未变，按钮仍可点"）
证据：（截图路径 / 控制台报错 / 网络状态）
已排除：
怀疑原因：
下一步：（只给一个方案，不要列三个让人选）
```
