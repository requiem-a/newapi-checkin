import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sitesPage = readFileSync(new URL("../frontend/src/features/sites/sites-page.tsx", import.meta.url), "utf8");
const checkinPage = readFileSync(new URL("../frontend/src/features/checkin/checkin-page.tsx", import.meta.url), "utf8");
const turnstileDialog = readFileSync(new URL("../frontend/src/features/checkin/turnstile-checkin.tsx", import.meta.url), "utf8");
const accountsPage = readFileSync(new URL("../frontend/src/features/accounts/accounts-page.tsx", import.meta.url), "utf8");
const healthDot = readFileSync(new URL("../frontend/src/shared/components/health-dot.tsx", import.meta.url), "utf8");

assert.ok(sitesPage.includes("http://") && sitesPage.includes("明文"), "新增 HTTP 站点必须提示明文传输风险");
assert.match(checkinPage, /disabled=\{!!busy \|\| !!embedDialog\}/, "内嵌签到期间必须禁用其他签到按钮");
assert.doesNotMatch(turnstileDialog, /settle\(seq,/, "内嵌 Turnstile 回调不能读取可变 seq");
assert.match(turnstileDialog, /abortRef\.current\?\.abort\(\)/, "取消弹窗必须中止在途签到请求");

// ── 站点健康点 ─────────────────────────────────────────────────────────────
// 四态映射与聚合优先级的**行为**断言在 tests/test_frontend_health.mjs（真跑纯函数）；
// 这里只盯源码扫描才能发现的问题：类名能不能被 Tailwind 扫到、有没有泄凭据、状态存哪。
//
// 扫之前先剥注释：源码注释里为了说明约束会写出反例（如"别拼 bg-checkin-xxx"），
// 不剥的话断言会被自己的文档骗过。
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "");
}

const healthDotCode = stripComments(healthDot);

assert.match(healthDotCode, /<button/, "健康点要用 button 包圆点（要可点击、可聚焦），不是 span");
assert.match(healthDotCode, /aria-label=\{label\}/, "健康点必须有 aria-label");
assert.doesNotMatch(healthDotCode, /-checkin-\$\{/, "颜色不许运行时拼类名——Tailwind v4 扫不到就会静默失效");
assert.doesNotMatch(healthDotCode, /access_token/, "tooltip 里绝不能出现 access_token");
assert.match(
  sitesPage,
  /const \[health, setHealth\] = useState<Record<string, SiteHealthEntry>>\(\{\}\)/,
  "健康态必须存在组件本地 useState，不能塞进 React Query 缓存（会和 site-accounts 键打架）",
);
assert.match(
  sitesPage,
  /setHealth\(\(prev\) => \{[\s\S]{0,200}delete next\[site\.id\]/,
  "切换代理后必须把该站点健康重置为灰（健康与出口绑定）",
);
assert.match(
  stripComments(accountsPage),
  /health=\{healthFromResult\(result\)\}[\s\S]{0,400}readOnly/,
  "账号行的健康点只读：数据源复用 balances，不新增请求",
);
console.log("frontend site contract regression passed");
