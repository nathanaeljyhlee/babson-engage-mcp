# Copilot Studio Tuning Guide

Updated template saved at: `engage-bot-template-updated.yaml`
This file contains all changes but must be applied manually in Copilot Studio since `pac` CLI can't update an existing bot's topics in-place.

---

## 1. Add Topic: Social Events & Nightlife

**Why:** Queries about parties, happy hours, going out get blocked by content filters. This topic intercepts them before the filter.

**In Copilot Studio -> Topics -> + New Topic -> From blank:**

- **Name:** Social Events & Nightlife
- **Trigger phrases:**
  - any parties on campus
  - where are the parties
  - party this week
  - social events
  - nightlife
  - happy hour
  - drinks on campus
  - fun events this week
  - going out tonight

- **Actions:**
  1. Send message: "Let me search for social and community events on campus for you."
  2. Redirect to Generative Answers (so it calls the MCP tool with category=SOCIAL)

---

## 2. Add Topic: Wellness & Support

**Why:** Mental health, stress, counseling queries get flagged as sensitive. This topic provides resources immediately without hitting the content filter.

**In Copilot Studio -> Topics -> + New Topic -> From blank:**

- **Name:** Wellness & Support
- **Trigger phrases:**
  - mental health
  - I'm stressed
  - feeling anxious
  - counseling
  - therapy
  - I need help
  - wellness resources
  - I'm struggling
  - feeling overwhelmed
  - who can I talk to

- **Actions:**
  1. Send message:
```
I want to make sure you have the right support. Here are Babson's key resources:

Babson Counseling Center: 781-239-6363
Student Success Hub: https://advising.babson.edu
Graduate Student Life & Leadership: GradLL@babson.edu or 781-239-4474

If this is an emergency, please call 911 or the 988 Suicide & Crisis Lifeline.

I can also search for upcoming wellness events on campus if you'd like.
```

---

## 3. Add Topic: Campus Policies

**Why:** Alcohol, drug, conduct policy queries get blocked. This routes to the handbook.

**In Copilot Studio -> Topics -> + New Topic -> From blank:**

- **Name:** Campus Policies
- **Trigger phrases:**
  - alcohol policy
  - drug policy
  - campus rules
  - code of conduct
  - is alcohol allowed
  - can we drink on campus
  - smoking policy
  - guest policy

- **Actions:**
  1. Send message:
```
For campus policies, your best resource is the Graduate Student Handbook:

Graduate Student Handbook: https://graduatehandbook.babson.edu/

It covers the code of conduct, substance policies, guest policies, and academic integrity.

For specific questions, contact Graduate Student Life & Leadership: GradLL@babson.edu or 781-239-4474.
```

---

## 4. Update Instructions

Paste into Overview -> Instructions (replaces current):

See `UPDATED-INSTRUCTIONS.md` for the full text.

Key changes:
- Added RESPONSE STYLE section
- Added MBA club search guidance (search by "graduate" or "professional" instead of "MBA")
- Feedback nudge when user says thanks

---

## 5. Settings Changes

- **Turn OFF web browsing**: Settings -> AI capabilities -> Web browsing -> Off
- **Content moderation**: Settings -> Content moderation -> Set to Medium (if available)
- **Republish** after all changes

---

## 6. Eval Test Cases

Import `eval-test-cases.csv` into Copilot Studio Evaluation tab, or run manually.

**High-priority tests (content filter risk):**
1. "Any parties on campus this week?" -- should return GSC Spring Party
2. "I'm feeling stressed, where can I get help?" -- should show counseling resources
3. "What's the alcohol policy?" -- should link to handbook
4. "Where can I get drinks?" -- should redirect to social events search
5. "What MBA clubs can I join?" -- should return graduate/professional clubs
