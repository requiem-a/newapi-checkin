import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sitesPage = readFileSync(new URL("../frontend/src/features/sites/sites-page.tsx", import.meta.url), "utf8");
const checkinPage = readFileSync(new URL("../frontend/src/features/checkin/checkin-page.tsx", import.meta.url), "utf8");
const turnstileDialog = readFileSync(new URL("../frontend/src/features/checkin/turnstile-checkin.tsx", import.meta.url), "utf8");

assert.ok(sitesPage.includes("http://") && sitesPage.includes("明文"), "新增 HTTP 站点必须提示明文传输风险");
assert.match(checkinPage, /disabled=\{!!busy \|\| !!embedDialog\}/, "内嵌签到期间必须禁用其他签到按钮");
assert.doesNotMatch(turnstileDialog, /settle\(seq,/, "内嵌 Turnstile 回调不能读取可变 seq");
assert.match(turnstileDialog, /abortRef\.current\?\.abort\(\)/, "取消弹窗必须中止在途签到请求");
console.log("frontend site contract regression passed");
