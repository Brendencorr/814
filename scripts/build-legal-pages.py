#!/usr/bin/env python3
# Generates the legal / trust pages (privacy, terms, disclaimer, safety, contact)
# by reusing home.html's shared HEAD / NAV / FOOTER / TAILSCRIPT so they match the
# marketing site exactly. Run AFTER build_marketing_pages.py so the footer links +
# entity line are already in place. Safe to re-run.
#
# All facts here are written to match the Phase 0 data-flow audit. Anything that
# depends on a business fact Brenden must confirm is marked with a visible
# <span class="todo">TODO(BRENDEN): ...</span> token so it can never silently ship.
import re, os

ROOT = "/Users/brendencorr/814 backend"
home = open(os.path.join(ROOT, "home.html"), encoding="utf-8").read()

HEAD = home[:home.index("</head>") + len("</head>")]
NAV = re.search(r'<nav class="nav" id="nav">.*?</nav>', home, re.DOTALL).group(0)
FOOTER = re.search(r'<footer>.*?</footer>', home, re.DOTALL).group(0)
_m = re.search(r'(<script>(?:(?!</script>).)*?io\.observe.*?</script>)', home, re.DOTALL)
TAILSCRIPT = _m.group(1) if _m else "<script></script>"


def page(title, body):
    head = HEAD.replace(
        "<title>The 8:14 Project — Health, Sobriety & Wellness</title>",
        "<title>" + title + " — The 8:14 Project</title>")
    return head + "\n<body>\n" + NAV + "\n<main>\n" + body + "\n</main>\n" + FOOTER + "\n" + TAILSCRIPT + "\n</body>\n</html>\n"


def hero(eyebrow, title, intro):
    return ('<header class="hero" style="padding:150px 0 26px">\n'
            '  <div class="hero-glow"></div>\n'
            '  <div class="wrap hero-inner">\n'
            '    <div class="eyebrow">' + eyebrow + '</div>\n'
            '    <h1 style="font-size:clamp(32px,5vw,52px)">' + title + '</h1>\n'
            '    <p class="body">' + intro + '</p>\n'
            '  </div>\n'
            '</header>\n')


def section(inner):
    return '<section class="section" style="padding-top:6px"><div class="wrap legal">\n' + inner + '\n</div></section>\n'


CRISIS_BOX = (
    '<div class="box">'
    '<div style="font-family:\'DM Serif Display\',serif;font-size:19px;color:var(--parchment);margin-bottom:6px">In crisis right now?</div>'
    '<div style="font-size:15px;color:var(--smoke);line-height:1.75">Call or text <strong style="color:var(--gold2)">988</strong> (Suicide &amp; Crisis Lifeline) &mdash; 24/7, free, and confidential. '
    'Call <strong style="color:var(--gold2)">911</strong> if you are in immediate danger. '
    'SAMHSA National Helpline: <strong style="color:var(--gold2)">1-800-662-4357</strong>.</div>'
    '</div>')

# ── PRIVACY ───────────────────────────────────────────────────────────────────
privacy = hero("Legal", "Privacy Policy",
    "How The 8:14 Project handles your information &mdash; in plain words. We built this for people in recovery, grief, and hard seasons, so privacy here is the point, not a formality.") + section('''
  <p class="updated">Effective date: <span class="todo">TODO(BRENDEN): effective date</span> &middot; Last updated: <span class="todo">TODO(BRENDEN): date</span></p>

  <h2>Who we are</h2>
  <p>The 8:14 Project is operated by <strong>814 LLC</strong>, a Montana limited liability company ("we," "us"). Mailing address: <span class="todo">TODO(BRENDEN): mailing address</span>. Contact: <a href="mailto:support@eight14.us">support@eight14.us</a> <span class="todo">TODO(BRENDEN): confirm this inbox is live before publishing</span>.</p>

  <h2>What we collect</h2>
  <h3>If you talk to Riley without an account (anonymous)</h3>
  <p>Your messages are sent to our AI provider to generate Riley's reply, but they are <strong>not saved to our database</strong>. They stay only in your browser for that session. We do not build a profile for anonymous visitors. The one exception: if a message contains signals of a safety crisis, a short excerpt may be recorded in a restricted safety log so we can respond responsibly.</p>
  <h3>If you create an account (Google sign-in)</h3>
  <ul>
    <li><strong>From Google:</strong> your name, email address, and profile photo.</li>
    <li><strong>What you tell Riley:</strong> the name and pronouns you give, why you're here, your goals, reflections, and your conversations.</li>
    <li><strong>How you're doing:</strong> the check-ins, mood, sleep, movement, nutrition, sobriety dates, habits, and similar entries you choose to log.</li>
    <li><strong>Riley's notes:</strong> so Riley can remember you between conversations, she distills durable facts (for example, what tends to keep you steady) into your private profile.</li>
    <li><strong>Operational data:</strong> standard security and hosting information (such as your network IP address at the server level) and the first-party browser storage described below.</li>
  </ul>

  <h2>How we use it</h2>
  <p>To run the service, personalize Riley's support, remember your context so you never have to repeat yourself, keep you safe, and send you the messages you've opted into.</p>

  <h2>What we never do</h2>
  <ul>
    <li>We do <strong>not sell</strong> your information.</li>
    <li>We do <strong>not use it for advertising</strong>.</li>
    <li>We do <strong>not use your conversations to train AI models</strong>.</li>
  </ul>

  <h2>Who processes data for us</h2>
  <p>We use a small set of service providers, each only for its stated purpose:</p>
  <ul>
    <li><strong>Netlify</strong> &mdash; website hosting.</li>
    <li><strong>Supabase</strong> &mdash; database and authentication (this is where your account data is stored).</li>
    <li><strong>Anthropic</strong> &mdash; the AI that powers Riley's replies. Your messages are sent to Anthropic to generate a response; under Anthropic's API terms, inputs are not used to train their models.</li>
    <li><strong>Google</strong> &mdash; sign-in (OAuth) and web fonts.</li>
    <li><strong>jsDelivr</strong> &mdash; serving a code library to your browser.</li>
    <li><strong>Resend</strong> &mdash; sending you email (such as a daily note or a check-in reminder) and internal safety alerts.</li>
    <li><strong>Payment processing</strong> &mdash; <span class="todo">TODO(BRENDEN): no payment processor is connected yet; name it here when paid plans go live</span>.</li>
  </ul>

  <h2>Cookies and browser storage</h2>
  <p>We use only <strong>first-party, essential storage</strong> &mdash; there are no advertising or analytics trackers on this site. This includes your sign-in session and small items that make the chat and daily check-ins work. Because we don't use tracking cookies, there is no cookie-consent banner to click through.</p>

  <h2>How long we keep it</h2>
  <p>We keep your account data until you delete it or ask us to. You can export or delete your data at any time (see Your Rights). <span class="todo">TODO(BRENDEN): confirm retention default &mdash; recommended: "until you delete your data or account."</span> Restricted safety records are kept separately and only to help keep you safe.</p>

  <h2>Your rights</h2>
  <p>You can access, export, and delete your data. Signed-in members can do this from <strong>Settings &rarr; Your Data</strong>, or by emailing <a href="mailto:support@eight14.us">support@eight14.us</a> &mdash; we'll respond within 30 days. Deleting removes your conversations, journal, and wellness entries; a minimal account shell may remain so you can sign back in, and safety records are handled separately.</p>

  <h2>California privacy rights (CCPA/CPRA)</h2>
  <p>If you are a California resident, you have the right to know what personal information we collect, to access and delete it, to correct it, and to not be discriminated against for exercising these rights. We do <strong>not</strong> sell or share personal information for cross-context behavioral advertising. To exercise any right, email <a href="mailto:support@eight14.us">support@eight14.us</a>.</p>

  <h2>Children</h2>
  <p>The 8:14 Project is not directed to children under 18, and we do not knowingly collect information from anyone under 18. <span class="todo">TODO(BRENDEN): confirm age policy</span>.</p>

  <h2>Security</h2>
  <p>Your records are protected by database row-level security so that only your account can read them, by encrypted (HTTPS) connections, and by server-side access controls. No system is perfectly secure, but protecting recovery conversations is our highest priority.</p>

  <h2>Changes and contact</h2>
  <p>If this policy changes, we'll post the update here and change the date above. Questions: <a href="mailto:support@eight14.us">support@eight14.us</a>. Governing law: Montana, USA.</p>
''')

# ── TERMS ─────────────────────────────────────────────────────────────────────
terms = hero("Legal", "Terms of Service",
    "The agreement between you and 814 LLC for using The 8:14 Project and talking with Riley.") + section('''
  <p class="updated">Effective date: <span class="todo">TODO(BRENDEN): effective date</span></p>

  <h2>The service</h2>
  <p>The 8:14 Project ("8:14"), operated by <strong>814 LLC</strong> (Montana), provides Riley &mdash; an AI wellness companion &mdash; along with tools for sobriety, movement, nutrition, and rebuilding your life. By using the site or talking with Riley, you agree to these Terms.</p>

  <h2>Riley is AI, and can be wrong</h2>
  <p>Riley is an artificial-intelligence companion, not a person and not a licensed professional. Riley can misunderstand, be incomplete, or be wrong. Riley does <strong>not provide medical, psychological, legal, or financial advice</strong>. Always use your own judgment and consult a qualified professional for medical or mental-health decisions. See our <a href="/disclaimer">Disclaimer</a>.</p>

  <h2>Not an emergency service</h2>
  <p>Riley is not a crisis or emergency service. If you are in crisis, call or text <strong>988</strong>, or <strong>911</strong> if you are in immediate danger. See our <a href="/disclaimer">Disclaimer</a> and <a href="/safety">Trust &amp; Safety</a> pages.</p>

  <h2>Your account</h2>
  <p>You sign in with Google and are responsible for your account and for what you choose to share. You must be <strong>18 or older</strong> to create an account.</p>

  <h2>Plans and billing</h2>
  <p>We offer <strong>Riley Guide</strong> (free), <strong>Riley Companion</strong> ($29/month), and <strong>Riley Coach</strong> ($49/month). <span class="todo">TODO(BRENDEN): payment processor, billing cycle, and refund/cancellation policy &mdash; no processor is connected yet, so paid plans are not currently purchasable</span>. When paid plans are live, you'll be able to cancel at any time, with access continuing through the period you've paid for.</p>

  <h2>Acceptable use</h2>
  <p>Please don't misuse the service: no unlawful use, no attempts to breach security or scrape data, and no using the service in ways that could harm yourself or others where a human or crisis service is what's needed.</p>

  <h2>Your content and ours</h2>
  <p>You keep ownership of what you write. You grant us permission to store and process it solely to provide the service (see our <a href="/privacy">Privacy Policy</a>). The site, Riley's design, and our written content are the intellectual property of 814 LLC.</p>

  <h2>Disclaimers and limitation of liability</h2>
  <p>The service is provided "as is," without warranties of any kind. To the maximum extent permitted by law, 814 LLC is not liable for indirect, incidental, or consequential damages, and our total liability is limited to the amount you paid us in the 12 months before the claim. Nothing here limits any liability that cannot be limited under applicable law.</p>

  <h2>Changes, termination, and law</h2>
  <p>We may update these Terms (we'll post the date) and may suspend accounts that violate them. These Terms are governed by the laws of Montana, USA. Questions: <a href="mailto:support@eight14.us">support@eight14.us</a>.</p>
''')

# ── DISCLAIMER ────────────────────────────────────────────────────────────────
disclaimer = hero("Important", "Wellness &amp; AI Disclaimer",
    "Riley is support, not treatment. Please read this.") + section(
    CRISIS_BOX + '''
  <h2>Riley is not a medical or mental-health professional</h2>
  <p>Riley is an AI wellness companion. Riley is <strong>not a doctor, therapist, counselor, psychologist, or licensed professional of any kind</strong>, and nothing Riley says is medical, psychological, or clinical advice, diagnosis, or treatment. Do not disregard or delay professional advice because of something Riley said.</p>

  <h2>Riley is not a crisis service</h2>
  <p>Riley cannot keep you safe in an emergency. If you are thinking about harming yourself, or you are in crisis, please reach a real person now: call or text <strong>988</strong> (Suicide &amp; Crisis Lifeline), call <strong>911</strong> if you are in immediate danger, and reach out to someone you trust. The <strong>SAMHSA National Helpline</strong> (<strong>1-800-662-4357</strong>) offers free, confidential treatment referrals 24/7.</p>

  <h2>AI can be wrong</h2>
  <p>Riley's responses are generated by artificial intelligence and can be inaccurate, incomplete, or out of date. Always verify anything important with a qualified professional.</p>

  <h2>Recovery and wellness are personal</h2>
  <p>What helps one person may not help another. Nothing here is a guarantee of any outcome. Use your own judgment and your own care team, and treat Riley as one steady source of support &mdash; not a replacement for professional care.</p>
''')

# ── SAFETY (Trust & Safety) ───────────────────────────────────────────────────
safety = hero("Trust &amp; Safety", "How Riley keeps your trust",
    "The people who come here are often at their most vulnerable. Here is exactly how Riley works, what we store, and what we will never do.") + section('''
  <h2>How Riley works</h2>
  <p>Riley is an AI companion available any hour. She's warm, direct, and built to listen without judgment. She is <strong>not a therapist or a crisis line</strong>, and she can be wrong. Think of her as a steady presence between the moments when other help is available &mdash; not a replacement for professional care. If you're in crisis, please see the resources below.</p>

  <h2>What we store, and where</h2>
  <ul>
    <li><strong>If you're not signed in:</strong> your conversation is <strong>not saved</strong> to our database. It stays in your browser for that visit and then it's gone.</li>
    <li><strong>If you sign in:</strong> your conversations, check-ins, and reflections are saved to your private account (in Supabase), protected by database row-level security so that <strong>only you</strong> can read them. Riley's replies are generated by Anthropic's AI, which does not use your messages to train its models.</li>
  </ul>

  <h2>What Riley will never do</h2>
  <ul>
    <li>Never judge you or shame you.</li>
    <li>Never sell your words, or use them for advertising.</li>
    <li>Never use your conversations to train AI models.</li>
    <li>Never assume your gender, pronouns, faith, or background.</li>
  </ul>

  <h2>What happens if you mention a crisis</h2>
  <p>If you signal that you might be in danger, Riley immediately stops coaching and shares real help &mdash; call or text <strong>988</strong>, <strong>911</strong> if you're in immediate danger, and a trusted person. This response is <strong>built in and deterministic</strong>: it doesn't depend on the AI "getting it right" in the moment. A minimal, restricted safety record is kept so we can follow up responsibly &mdash; it is never used for marketing or personalization.</p>
  ''' + CRISIS_BOX + '''

  <h2>Your data, your control</h2>
  <p>You can export or delete everything from <strong>Settings &rarr; Your Data</strong> at any time, or email <a href="mailto:support@eight14.us">support@eight14.us</a>. See our <a href="/privacy">Privacy Policy</a> for the full detail.</p>
''')

# ── CONTACT ───────────────────────────────────────────────────────────────────
contact = hero("Contact", "Get in touch",
    "We're a small team. The best way to reach us is email.") + section('''
  <h2>Support</h2>
  <p>Email <a href="mailto:support@eight14.us">support@eight14.us</a> <span class="todo">TODO(BRENDEN): confirm this inbox is live before publishing</span>. We aim to respond within <span class="todo">TODO(BRENDEN): response-time promise, e.g. 2 business days</span>.</p>

  <h2>Privacy requests</h2>
  <p>For access, export, or deletion of your data, email the same address. We respond to privacy requests within 30 days. Members can also self-serve from Settings &rarr; Your Data.</p>
  ''' + CRISIS_BOX + '''

  <h2>Who we are</h2>
  <p><strong>814 LLC</strong> &middot; Montana, USA &middot; <span class="todo">TODO(BRENDEN): mailing address</span></p>
''')

PAGES = [
    ("privacy.html",    "Privacy Policy",             privacy),
    ("terms.html",      "Terms of Service",           terms),
    ("disclaimer.html", "Disclaimer",                 disclaimer),
    ("safety.html",     "Trust & Safety",             safety),
    ("contact.html",    "Contact",                    contact),
]

for fname, title, body in PAGES:
    open(os.path.join(ROOT, fname), "w", encoding="utf-8").write(page(title, body))
    print("wrote", fname)
print("done: legal pages generated from home.html shared shell")
