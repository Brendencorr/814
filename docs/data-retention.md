# Data Retention Policy (Master Build Spec §11)

Plain-language member version links from the privacy policy. **Counsel must review before launch**
— especially the crisis-record retention line.

| Data | Retention | Rationale |
|---|---|---|
| Chat transcripts (`riley_conversations`) | Life of account; deleted on account deletion | Continuity of care |
| Memories (`riley_memory`, `life_map`) | Life of account; member-correctable + deletable anytime (Phase 6) | Member owns their model |
| Session summaries | Life of account | Episodic recall |
| Check-ins / mood / sobriety | Life of account | Progress + safety |
| Clinical screeners (WHO-5/PHQ/GAD) | Life of account | Baseline + trend |
| **Crisis records (`crisis_log`)** | **Retained de-identified ~12 months after account deletion** | Safety record / duty-of-care; **decide final term with counsel** |
| Engagement / behavioral (Tier 3) | Rolling 24 months, then aggregate-only | Product analytics |
| API cost / incidents | 24 months (hashed ids) | Ops observability |
| Financial records (`payments`, `purchases`) | Per legal/tax requirement | Law |

## Account deletion
Self-serve, **7-day grace window** with email confirmation, then hard-delete member rows across
all tables + redact conversation content. Retained after deletion: anonymized aggregate stats,
legally-required financial records, and de-identified `crisis_log` per the safety line above.
(Account-deletion flow shipped 2026-07; verify it now covers the v2 tables: `riley_memory`,
`life_map`, `session_summaries`, `chat_turn_signals` — see punch list.)

## Member data export (Phase 11 — TODO)
"Download my data" → background job compiles profile + memories + conversations + check-ins +
progress into JSON + a human-readable PDF → time-limited signed URL. GDPR/CCPA portability shape.

## Encryption
Supabase encrypts at rest; TLS in transit everywhere. Service + VAPID keys live in env only.
Quarterly key-rotation calendar (OPERATOR_KEY rotated 2026-07-07 sets the precedent).
