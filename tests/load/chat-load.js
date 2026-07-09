// tests/load/chat-load.js — k6 load test for the chat path (Master Build Spec §9.4).
//
// ⚠️ RUN AGAINST STAGING, NOT PRODUCTION — this drives real model calls (cost + load).
//   k6 run -e BASE=https://staging.meetriley.us tests/load/chat-load.js
//
// Ramps to 200 concurrent sessions; assert p95 < 10s and <2% failures. Re-run at each scale
// milestone (500 / 1000 / 5000 VUs) per the spec. Verifies the 14-parallel-query context build
// holds up; if p95 blows out, consolidate context reads into a single RPC.
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "1m", target: 50 },
    { duration: "2m", target: 200 },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<10000"],
    http_req_failed: ["rate<0.02"],
  },
};

const BASE = __ENV.BASE || "https://staging.meetriley.us";
const MSGS = [
  "hi",
  "how are you today",
  "I had a rough day and I'm not sure why",
  "what should I focus on right now",
  "feeling tired but okay",
  "I want to build a better morning routine",
];

export default function () {
  const body = JSON.stringify({ message: MSGS[Math.floor(Math.random() * MSGS.length)] });
  const res = http.post(`${BASE}/.netlify/functions/riley-chat`, body, {
    headers: { "Content-Type": "application/json" },
    timeout: "30s",
  });
  check(res, {
    "status 200": (r) => r.status === 200,
    "non-empty reply": (r) => (r.body || "").length > 0,
  });
  sleep(Math.random() * 3 + 1);
}
