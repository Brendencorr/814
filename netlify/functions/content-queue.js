/**
 * content-queue.js - admin API for the content Review screen.
 * Called by the operator dashboard (password-gated, server-side service key).
 *
 * GET  ?view=pending|review|scheduled|published|counts   → list queue / jobs
 * POST {action:'approve', id}       → assign + render a design → status 'designed' (Review)
 * POST {action:'swap_design', id, ground, layout?}  → re-render on a different ground
 * POST {action:'publish', id}       → Echo per-platform → publishing_jobs → FeedHive (with media)
 * POST {action:'revise', id, note}
 * POST {action:'reject', id}
 *
 * Two-step: approve = approve the COPY (auto-assigns a design, moves to Review);
 * publish = final approval of the finished post. Design engine = content-design.js.
 * HARD RULE: an item with safety_verdict='block' can NEVER be approved here.
 */

const { contentDb, loadPrompt, callClaude, extractJson, notify, CORS, requireOperator } = require("./content-lib");
const { renderBrief } = require("./content-design");

function json(status, data) {
  return { statusCode: status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(data) };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const _gate = requireOperator(event); if (_gate) return _gate;
  const db = contentDb();

  try {
    // ── GET: lists ─────────────────────────────────────────────────────────
    if (event.httpMethod === "GET") {
      const view = (event.queryStringParameters || {}).view || "pending";

      if (view === "counts") {
        const [pending, review, scheduled, published, runs] = await Promise.all([
          db.from("content_approval_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
          db.from("content_approval_queue").select("id", { count: "exact", head: true }).eq("status", "designed"),
          db.from("content_publishing_jobs").select("id", { count: "exact", head: true }).in("state", ["queued", "sent_to_buffer", "scheduled"]),
          db.from("content_publishing_jobs").select("id", { count: "exact", head: true }).eq("state", "published"),
          db.from("content_engine_runs").select("*").order("started_at", { ascending: false }).limit(1),
        ]);
        return json(200, {
          pending: pending.count || 0,
          review: review.count || 0,
          scheduled: scheduled.count || 0,
          published: published.count || 0,
          last_run: runs.data?.[0] || null,
        });
      }

      if (view === "scheduled" || view === "published") {
        const states = view === "scheduled" ? ["queued", "sent_to_buffer", "scheduled"] : ["published"];
        const { data } = await db.from("content_publishing_jobs").select("*").in("state", states)
          .order("scheduled_for", { ascending: view === "scheduled" }).limit(60);
        return json(200, { jobs: data || [] });
      }

      if (view === "performance") {
        const since = new Date(Date.now() - 30 * 864e5).toISOString();
        const { data: jobs } = await db.from("content_publishing_jobs")
          .select("id, platform, caption_final, created_at, published_at")
          .eq("state", "published").gte("created_at", since).limit(200);
        const ids = (jobs || []).map((j) => j.id);
        let metrics = [];
        if (ids.length) { const r = await db.from("content_performance_metrics").select("*").in("job_id", ids); metrics = r.data || []; }
        const byJob = {}; metrics.forEach((m) => { byJob[m.job_id] = m; });
        const enriched = (jobs || []).map((j) => {
          const m = byJob[j.id] || {};
          const engagement = (m.likes||0)+(m.comments||0)+(m.shares||0)+(m.saves||0);
          return { id: j.id, platform: j.platform, caption: (j.caption_final||"").slice(0,120),
                   impressions: m.impressions||0, reach: m.reach||0, engagement, clicks: m.clicks||0, published_at: j.published_at };
        });
        const plat = {};
        enriched.forEach((e) => {
          const pp = plat[e.platform] || { platform: e.platform, posts: 0, engagement: 0, clicks: 0, reach: 0 };
          pp.posts++; pp.engagement += e.engagement; pp.clicks += e.clicks; pp.reach += e.reach; plat[e.platform] = pp;
        });
        const sorted = [...enriched].sort((a,b) => b.engagement - a.engagement);
        const { data: learn } = await db.from("content_learnings").select("*").order("created_at",{ascending:false}).limit(1);
        return json(200, {
          posts: enriched,
          top: sorted.slice(0,5),
          bottom: sorted.filter((e)=>e.impressions>0).slice(-5).reverse(),
          platforms: Object.values(plat),
          learnings: (learn && learn[0]) || null,
          has_data: metrics.length > 0,
        });
      }

      // review queue - items with a design assigned, awaiting final approval
      if (view === "review") {
        const { data: q } = await db.from("content_approval_queue").select("*")
          .eq("status", "designed").order("reviewed_at", { ascending: false }).limit(60);
        const briefIds = [...new Set((q || []).map((r) => r.brief_id).filter(Boolean))];
        let assetsByBrief = {}, captionByBrief = {};
        if (briefIds.length) {
          const { data: assets } = await db.from("content_creative_assets")
            .select("brief_id, file_url, template_id, dimensions, alt_text").in("brief_id", briefIds);
          (assets || []).forEach((a) => { (assetsByBrief[a.brief_id] = assetsByBrief[a.brief_id] || []).push(a); });
          const { data: briefs } = await db.from("content_briefs").select("id, caption, headline_hook").in("id", briefIds);
          (briefs || []).forEach((b) => { captionByBrief[b.id] = b; });
        }
        const queue = (q || []).map((r) => ({
          ...r,
          assets: assetsByBrief[r.brief_id] || [],
          brief: captionByBrief[r.brief_id] || null,
        }));
        return json(200, { queue });
      }

      // pending queue (default) - include brief caption + assets
      const { data: queue } = await db.from("content_approval_queue").select("*")
        .eq("status", "pending").order("created_at", { ascending: false }).limit(60);
      return json(200, { queue: queue || [] });
    }

    // ── POST: actions ────────────────────────────────────────────────────────
    const body = JSON.parse(event.body || "{}");
    const { action, id, note } = body;
    if (!action || !id) return json(400, { error: "action and id required" });

    const { data: item, error: itemErr } = await db.from("content_approval_queue").select("*").eq("id", id).single();
    if (itemErr || !item) return json(404, { error: "queue item not found" });

    // REJECT
    if (action === "reject") {
      await db.from("content_approval_queue").update({ status: "rejected", reviewed_at: new Date().toISOString() }).eq("id", id);
      return json(200, { ok: true, status: "rejected" });
    }

    // REVISE
    if (action === "revise") {
      await db.from("content_approval_queue").update({ status: "revise", reviewer_note: note || null, reviewed_at: new Date().toISOString() }).eq("id", id);
      await notify(`Content item sent back for revision: ${item.preview_caption?.slice(0, 80) || item.id}${note ? " - " + note : ""}`);
      return json(200, { ok: true, status: "revise" });
    }

    // APPROVE (copy) → auto-assign + render a design → move to Review (status 'designed')
    if (action === "approve") {
      // HARD GATE: blocked items can never be approved.
      if (item.safety_verdict === "block") {
        return json(403, { error: "This item is blocked by Sentinel and cannot be approved. Revise or reject it." });
      }
      let design = { designed: false, assets: [] };
      if (item.brief_id) {
        try { design = await renderBrief(item.brief_id); }
        catch (e) { design = { designed: false, reason: e.message, assets: [] }; }
      }
      const assetIds = (design.assets || []).map((a) => a.id);
      await db.from("content_approval_queue").update({
        status: "designed",
        asset_ids: assetIds.length ? assetIds : (item.asset_ids || null),
        reviewed_at: new Date().toISOString(),
      }).eq("id", id);
      return json(200, { ok: true, status: "designed", designed: design.designed, assets: design.assets || [], reason: design.reason || null });
    }

    // SWAP the assigned design (re-render on a chosen ground/layout) - stays in Review
    if (action === "swap_design") {
      if (!item.brief_id) return json(400, { error: "this item has no brief to design" });
      if (!body.ground) return json(400, { error: "ground required" });
      await db.from("content_creative_assets").delete().eq("brief_id", item.brief_id).eq("render_engine", "riley-grounds");
      let r;
      try { r = await renderBrief(item.brief_id, { override: { ground: body.ground, layout: body.layout } }); }
      catch (e) { return json(500, { error: "render failed: " + e.message }); }
      const swapIds = (r.assets || []).map((a) => a.id);
      await db.from("content_approval_queue").update({ asset_ids: swapIds }).eq("id", id);
      return json(200, { ok: true, status: "designed", designed: r.designed, assets: r.assets || [] });
    }

    // PUBLISH (final approval) → Echo per-platform → publishing jobs → FeedHive (with media)
    if (action === "publish" || action === "final_approve") {
      // HARD GATE: blocked items can never be published.
      if (item.safety_verdict === "block") {
        return json(403, { error: "This item is blocked by Sentinel and cannot be approved. Revise or reject it." });
      }

      await db.from("content_approval_queue").update({ status: "approved", reviewed_at: new Date().toISOString() }).eq("id", id);

      // Build the master caption + assets for Echo
      let masterCaption = item.preview_caption || "";
      let mediaUrls = [];
      let programTie = "none";
      if (item.brief_id) {
        const { data: brief } = await db.from("content_briefs").select("*").eq("id", item.brief_id).single();
        if (brief) { masterCaption = brief.caption || masterCaption; programTie = brief.program_tie || "none"; }
        const { data: assets } = await db.from("content_creative_assets").select("file_url").eq("brief_id", item.brief_id);
        mediaUrls = (assets || []).map((a) => a.file_url).filter(Boolean);
      }

      // Echo: per-platform packages
      const today = new Date().toISOString().slice(0, 10);
      const { data: disc } = await db.from("content_daily_discoverability").select("*").eq("run_date", today).single();
      const echoPrompt = await loadPrompt("echo");
      const echoRaw = await callClaude({
        system: echoPrompt,
        user: `APPROVED ITEM:\n${JSON.stringify({ kind: item.kind, caption: masterCaption, platforms: item.platforms, original_url: item.original_url, original_creator: item.original_creator, program_tie: programTie, media_urls: mediaUrls }, null, 2)}\n\nTODAY'S DISCOVERABILITY:\n${JSON.stringify(disc || {}, null, 2)}\n\nProduce per-platform packages JSON.`,
        maxTokens: 2500,
      });
      const echo = extractJson(echoRaw) || { packages: [] };
      const packages = Array.isArray(echo.packages) ? echo.packages : [];

      // Create publishing jobs + push to FeedHive (feedhive-publish resolves accounts + key itself)
      const siteUrl = process.env.URL || "";
      let scheduledCount = 0;

      for (const pkg of packages) {
        const jobRow = {
          approval_id: id,
          platform: ["instagram","tiktok","linkedin","facebook","youtube_shorts","pinterest","x"].includes(pkg.platform) ? pkg.platform : "instagram",
          publisher: "feedhive",
          caption_final: pkg.caption_final || masterCaption,
          hashtags_final: pkg.hashtags_final || [],
          media_urls: pkg.media_urls || mediaUrls,
          utm_url: pkg.utm_url || null,
          scheduled_for: pkg.scheduled_for || null,
          state: "queued",
        };
        const { data: job } = await db.from("content_publishing_jobs").insert(jobRow).select().single();

        // Push to FeedHive if the site URL is set (reposts = quote/link with attribution, never re-upload)
        if (siteUrl) {
          try {
            let text = jobRow.caption_final;
            if (jobRow.hashtags_final?.length) text += "\n\n" + jobRow.hashtags_final.join(" ");
            if (item.kind === "repost" && item.original_url) {
              text = `${jobRow.caption_final}\n\nvia ${item.original_creator || "original creator"}: ${item.original_url}`;
            }
            // attach the rendered design(s) as media (reposts link the original, never re-upload)
            const media = (item.kind === "repost") ? [] : (jobRow.media_urls || []).filter(Boolean).map((u) => ({ type: "image", url: u }));
            const res = await fetch(`${siteUrl}/.netlify/functions/feedhive-publish`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-operator-key": process.env.OPERATOR_KEY || "" },
              body: JSON.stringify({ text, scheduled_at: jobRow.scheduled_for, media }),
            });
            const bd = await res.json();
            if (bd.success) {
              await db.from("content_publishing_jobs").update({ state: "scheduled", buffer_post_id: bd.update_id || "scheduled" }).eq("id", job.id);
              scheduledCount++;
            } else {
              await db.from("content_publishing_jobs").update({ state: "failed", error_detail: bd.error || "buffer error" }).eq("id", job.id);
            }
          } catch (e) {
            await db.from("content_publishing_jobs").update({ state: "failed", error_detail: e.message }).eq("id", job.id);
          }
        } else {
          scheduledCount++; // no Buffer configured - job stays queued for manual handling
        }
      }

      await db.from("content_approval_queue").update({ status: "scheduled" }).eq("id", id);
      return json(200, { ok: true, status: "scheduled", jobs: packages.length, buffered: scheduledCount });
    }

    return json(400, { error: "unknown action" });

  } catch (err) {
    console.error("content-queue error:", err.message);
    return json(500, { error: err.message });
  }
};
