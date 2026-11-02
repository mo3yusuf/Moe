# Legal, privacy, payments & security: items for professional review

This is an engineering checklist, **not legal advice**. Each item needs review by a qualified Australian lawyer, privacy professional, accountant or security assessor before launch.

## Privacy (Privacy Act 1988 & Australian Privacy Principles)
- [ ] **APP 1/5 – Privacy policy and collection notices.** A policy must exist before launch and cover behavioural personalisation, approximate location, video uploads, comments, payments and disclosures to restaurants/creators/processors. The app currently shows a draft notice only.
- [ ] **Small-business exemption.** Don't rely on it. The business may exceed the $3M turnover threshold, and the 2024 reforms are narrowing the exemption. Build to APP standards from the start (we have).
- [ ] **Consent model for personalisation.** The sign-up screen has a personalisation toggle that is ON by default, with a clear explanation and a recorded consent. Confirm whether this is acceptable or should be opt-in, given the Privacy and Other Legislation Amendment Act 2024 and the upcoming Children's Online Privacy Code.
- [ ] **Age.** Users confirm they are 16+. Decide on a minimum age and age-assurance approach. Check obligations under the Online Safety Act and the social media minimum age rules (16) for a platform with UGC video, comments and follows: **high priority**.
- [ ] **Cross-border disclosure (APP 8).** Host Supabase and the API in Sydney (ap-southeast-2). Identify any processors outside Australia (Stripe, Expo, email, analytics).
- [ ] **Retention.** Raw interaction events: 180 days (function provided, needs scheduling). Orders are kept without identity after account deletion for ATO record-keeping (5 years). Confirm these periods.
- [ ] **Data breach response plan** (Notifiable Data Breaches scheme).
- [ ] **Sensitive information.** CRAVE does not infer religion or health. Halal/vegan/allergy settings are user-entered preferences. Confirm whether storing them is "sensitive information" requiring consent, and word the UI accordingly.

## Consumer law (Australian Consumer Law)
- [ ] **Pricing.** All prices are shown GST-inclusive in AUD. Total price including fees must be shown before payment (drip-pricing rules). Customer fees are currently $0.
- [ ] **Refunds and cancellations policy** for restaurant-rejected orders, unavailable items, quality issues. Consumer guarantees can't be excluded.
- [ ] **Influencer and sponsored content.** CRAVE requires a disclosure for paid or gifted videos (AANA Code, ACCC influencer guidance). Moderation can act on "undisclosed sponsorship" reports.
- [ ] **Allergen and dietary claims.** Allergen and halal information is restaurant-declared. The app shows a warning, and "halal certified" is shown only after CRAVE staff check a certificate. Get advice on liability and Food Standards Code obligations (who is the "seller").
- [ ] **Unfair contract terms** in the restaurant merchant agreement (commission, chargebacks, delisting).

## Payments
- [ ] **Stripe Connect platform approval.** Choose the charge type (destination charges with `application_fee_amount` are assumed in the schema) and the account type (Express), plus restaurant KYC.
- [ ] **PCI DSS.** Use Stripe PaymentSheet/Elements only, so card data never touches CRAVE servers (SAQ A). Never log card data.
- [ ] **GST on CRAVE's commission and fees.** CRAVE must register for GST and issue tax invoices to restaurants for commission. Restaurants are responsible for GST on food. Is CRAVE an agent or principal? This affects tax invoices to customers. **Accountant review required.**
- [ ] **Apple Pay / Google Pay merchant setup.** Physical goods (food) may use Apple Pay rather than in-app purchase. Confirm this with App Store Review Guideline 3.1.3(e)/3.1.5.
- [ ] **Chargebacks and disputes:** policy on who bears the loss (platform vs restaurant).

## Platform and content
- [ ] **Online Safety Act 2021 / Basic Online Safety Expectations:** reporting tools (built), response times, eSafety complaints, and the industry codes for user-generated content.
- [ ] **Copyright.** Uploaders confirm rights (captured). A DMCA-style takedown process and repeat-infringer policy are needed. No content is imported from TikTok or Instagram.
- [ ] **Music in videos:** licensing for background audio is a significant risk. Consider muting uploads or using a licensed music library.
- [ ] **App Store / Play requirements:** UGC apps need reporting, blocking, a terms agreement and moderation (Guideline 1.2). In-app account deletion is required (5.1.1(v)) and is **planned for Phase 7**.

## Security review before pilot
- [ ] Independent review of RLS policies and SECURITY DEFINER functions (`supabase/migrations/*07_rls.sql`)
- [ ] Penetration test of the API and Supabase project
- [ ] Rate limiting / abuse protection on `/v1/events`, sign-up and comments
- [ ] Secrets management (service role key only on the API host), key rotation
- [ ] Production Supabase: email confirmation ON, leaked-password protection, MFA for admins and restaurant owners
- [ ] Logging and monitoring that avoids personal data in logs
