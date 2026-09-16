import assert from "node:assert/strict";
import { buildSiteScript, filterPendingAccounts } from "../frontend/src/features/checkin/build-site-script.ts";

const accounts = [
  { name: "same", access_token: "t1", user_id: "1" },
  { name: "same", access_token: "t2", user_id: "2" },
];

const pending = filterPendingAccounts(accounts, [
  { name: "same", user_id: "1", success: true, message: "今日已签到" },
  { name: "same", user_id: "2", success: false, message: "今日未签到" },
]);

assert.deepEqual(pending.map((a) => a.user_id), ["2"], "同名账号应按 user_id 区分同步状态");

const script = buildSiteScript(
  { sign_in_path: "/api/user/checkin", api_user_key: "new-api-user" },
  [accounts[0]],
  { site_key: "site-key" },
);
assert.match(script, /callback: t => settle\(s, null, t\)/, "Turnstile 回调必须捕获当前 challenge 序号");
assert.doesNotMatch(script, /settle\(seq,/, "Turnstile 回调不能读取可变 seq");
console.log("frontend checkin helper regression passed");
